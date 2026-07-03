# Maintenance & hardening — archived (delivered) cards

> Full history also in git. Live roadmap keeps only the ledger row.

- [x] **MNT-16 — Hook-block agent self-approval of Playwright visual baselines via Bash (P1)**

  **Created:** 2026-07-03 · **Completed:** 2026-07-03

  Regenerating visual baselines under `frontend/tests/e2e/*-snapshots/` is a human-approval
  step (a human runs `npm run test:e2e:update`, reviews the diff, commits the PNGs). Nothing
  currently stops an agent from re-baselining a *failing* screenshot test via Bash instead of
  fixing the regression — silently defeating the visual gate. Add a `PreToolUse(Bash)` guard
  that denies baseline-update commands. A draft implementation exists on branch
  `feature/mnt-17` (produced by a hallucinated batch run); its tests were self-authored, so
  the hook must be **re-derived pipeline-grade** (independent test author), not merged as-is.

  **Type:** Feature

  **Files:** `.claude/hooks/guard-visual-update.sh` (new) ·
  `.claude/hooks/tests/guard-visual-update.test.sh` (new) ·
  `.claude/settings.json` (wire the PreToolUse Bash matcher)

  **Config/schema impact:** None — harness/tooling hook only.

  **Acceptance criteria**
  - A `PreToolUse(Bash)` hook denies `npm run test:e2e:update` (with any leading `cd`/path prefix)
  - Denies `playwright test --update-snapshots` and the `-u` alias, including `npx`/`cd`/path
    prefixes and extra flags
  - Does NOT block unrelated `-u` usages (`git push -u`, `sort -u`) or non-playwright commands
  - Empty/unparseable `tool_input.command` does not block (fail-safe open)
  - A denial returns a PreToolUse `permissionDecision: "deny"` with a human-approval reason
  - The hook is wired in `.claude/settings.json` under the Bash PreToolUse matcher

  **Unit tests:** `.claude/hooks/tests/guard-visual-update.test.sh` (new) — bash cases:
  denies `npm run test:e2e:update`; denies `cd frontend && npm run test:e2e:update`; denies
  `npx playwright test --update-snapshots`; denies `playwright test -u`; ALLOWS `git push -u
  origin x`, `sort -u file`, `npm run test:e2e` (run not update), and an empty command.

  **E2E:** N/A (harness hook — no UI/app surface; behavior is fully covered by the bash test harness).

  **UAT:** N/A (non-UI/CLI tooling; PR review + the Verify command are the human gate).

  **Verify:** `bash .claude/hooks/tests/guard-visual-update.test.sh`

---

---

- [x] **MNT-15 — Fix: manually-created charts can ship with a blank title (P2)**

  **Created:** 2026-07-01 · **Started:** 2026-07-03 · **Completed:** 2026-07-03

  In the Composition tab's `ChartModal`, only `name` is validated as required — `title` has
  no such check, and the submit handler always writes `title: title.trim()` into the chart
  config, including `""` when the field is left blank. At render time,
  `generate_chart` in `src/reports/charts.py` does
  `title = chart_cfg.get("title", name)`, which only falls back to the chart's internal
  `name` slug when the `title` **key is absent** — since the UI always writes the key (even
  empty), that fallback never fires, so `ax.set_title("")` ships a chart with a blank header
  in the built report. `--auto-charts` (`default_charts.py`, falls back through
  `export_label`/`label`/`kobo_key`) and the AI chart suggester (`title` is a `required` field
  in its forced structured-output schema) are unaffected — only charts a user hand-creates via
  the Composition modal and skips the Title field on are at risk.

  **Type:** Fix

  **Files:** `frontend/src/pages/Composition.jsx` (`ChartModal` ~1654-1666) ·
  `src/reports/charts.py` (`generate_chart` ~line 50) · `tests/test_charts.py` (new) ·
  `frontend/tests/e2e/composition-chart-title-required.spec.ts` (new)

  **Config/schema impact:** None — validation + fallback hardening only; no new config field.

  **Acceptance criteria**
  - Submitting the `ChartModal` with an empty Title field shows a required-field validation
    error (same pattern as the existing `name` check) and does not call `onSave`
  - `generate_chart` falls back to the chart's `name` when `title` is falsy (empty string OR
    missing), not only when the key is absent
  - A chart config with `title: ""` renders with the `name` slug as its title, not a blank
    header
  - All existing tests remain green

  **Unit tests:** `tests/test_charts.py` (new) — covers the Python-side fallback fully:
  - `test_generate_chart_title_falls_back_to_name_when_missing`: chart config with no `title`
    key → rendered title equals `name`
  - `test_generate_chart_title_falls_back_to_name_when_empty_string`: chart config with
    `title: ""` → rendered title equals `name`, not blank
  - `test_generate_chart_title_uses_provided_title`: chart config with a non-empty `title` →
    rendered title is unchanged

  The frontend `ChartModal` Title-required guard has no separate unit-test entry: this repo
  has no frontend unit-test framework (no Vitest/Jest/RTL — only Playwright E2E exists per
  `CLAUDE.md`'s stated stack), and the guard itself is a single-line check (block submit if
  `title.trim()` is empty) with no isolable logic beyond what the E2E spec below already
  exercises directly (asserts the error appears AND `onSave` is not called). Standing up a
  new unit-test framework for one one-line guard is disproportionate; N/A is justified here
  in a way the original blanket N/A was not — this is a trivial guard fully covered by E2E,
  not complex state/timing logic (contrast with PUX-11's debounce/preview-state hook, which
  does warrant a fast unit test and got one).

  **E2E:** `frontend/tests/e2e/composition-chart-title-required.spec.ts` (new) + visual
  (impeccable audit/critique + `toHaveScreenshot`) —
  - Open Composition → Add chart → fill Name, leave Title blank → click Save → assert a
    required-field error is shown and the modal stays open
  - `toHaveScreenshot('composition-chart-title-required.png')` at mobile 390×844, tablet
    820×1180, desktop 1440×900

  **UAT:**
  1. Composition tab → Add chart. Enter a Name, pick columns, leave Title blank, click Save.
     Expected: a "Title is required" validation message appears and the modal does not close.
  2. Fill in a Title and save. Run `python3 src/data/make.py build-report --sample 5` on a
     downloaded dataset and open the output `.docx`. Expected: the chart shows the entered
     title, not blank.

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_charts.py -q` ·
  `PYTHONPATH=. MPLBACKEND=Agg python -m pytest -q` ·
  `cd frontend && npx playwright test composition-chart-title-required.spec.ts`

---

- [x] **MNT-14 — Handle a `[[`/`]]` delimiter character split mid-token across docx runs (P2)**

  **Created:** 2026-07-01 · **Started:** 2026-07-03 · **Completed:** 2026-07-03

  Follow-up from MNT-8. `_clean_runs` in `src/reports/builder.py` strips `[[...]]` tokens
  per-run, which correctly handles a delimiter split *between* runs (e.g. `[[` in one run,
  `NOM]]` in the next — each run still contains a complete, intact delimiter). It does not
  handle a delimiter *character itself* broken across runs (e.g. `"["`, `"[NOM]"`, `"]"` as
  three separate runs) — confirmed via a probe test during MNT-8 verification that this case
  still leaves `[[NOM]]` unstripped in the output. Fix requires merging/joining run text within
  a paragraph before pattern-matching, then redistributing the cleaned text back across runs
  (or collapsing to a single run), rather than the current independent per-run replace.

  **Files:** `src/reports/builder.py`

  **Config/schema impact:** None — behaviour fix only.

  **Acceptance criteria**
  - A paragraph where a `[[...]]` or `]]`/`[[` delimiter character is itself split across two
    or more separate runs is still fully stripped after `build_report`, with inner text preserved
  - The existing MNT-8 cases (intra-run tokens, tokens split at a run boundary with each run
    holding a complete delimiter) remain green — no regression
  - Existing `{{ }}` Jinja2 placeholders that were properly filled remain unaffected

  **Unit tests:** `tests/test_builder.py`:
  - `test_strip_token_with_delimiter_char_split_across_runs`: construct a docx where the `[[`
    or `]]` delimiter itself is broken mid-character across 2+ runs → assert output contains
    the inner text and no `[[`/`]]`.
  - Existing MNT-8 tests remain green (no regression).

  **E2E:** N/A (no new UI surface; behaviour is in the Python report-build path).

  **UAT:** N/A (non-UI fix; verified via unit test + PR review).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_builder.py -q` ·
  `PYTHONPATH=. MPLBACKEND=Agg python -m pytest -q`

---

- [x] **MNT-13 — Fix unbounded `select(User)` in `apply_superadmin_emails` (P1)**

  **Created:** 2026-07-01 · **Completed:** 2026-07-01

  `apply_superadmin_emails` in `web/db/repository.py` executes `db.scalars(select(User))`
  — a full table scan with no `WHERE` or `LIMIT` — then Python-filters by email. As the
  user table grows this is a DoS risk on every startup. Fix: replace with
  `select(User).where(User.email.in_(wanted_emails))` so the DB does the filtering.

  **Files:** `web/db/repository.py`

  **Config/schema impact:** None — query fix only, no model change.

  **Acceptance criteria**
  - `apply_superadmin_emails` issues a `SELECT … WHERE email IN (…)` query, not a full scan
  - When `SUPERADMIN_EMAILS` is empty the function issues no DB query at all
  - All existing tests remain green

  **Unit tests:** `tests/test_bridge.py` (or a new `tests/test_repository.py`) —
  - `test_apply_superadmin_emails_filtered_query`: mock `db` session; assert the emitted SQL
    contains a `WHERE` clause on `email`; assert no full-scan `SELECT * FROM users` is issued.
  - `test_apply_superadmin_emails_empty_noop`: call with empty `SUPERADMIN_EMAILS`; assert
    `db.scalars` is not called.

  **E2E:** N/A (backend query fix; no UI surface change).

  **UAT:** N/A (non-UI; verified via unit test + PR review).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/ -q`

---

- [x] **MNT-12 — Fix N+1 role queries in `/api/projects` list endpoint (P1)**

  **Created:** 2026-06-28 · **Completed:** 2026-07-02

  **Type:** Fix

  `_project_dict()` in `web/main.py` calls `db_repo.role_for(user, project, db)` once per
  project in the list; `role_for` issues a separate `SELECT … FROM project_memberships` per
  call. A user with N projects triggers N+1 DB round-trips on every `/api/projects` load.
  Fix: batch-fetch all `ProjectMembership` rows for the user in a single query before the
  list comprehension, then resolve roles from the result map in memory.

  **Files:** `web/main.py` · `web/db/repository.py`

  **Config/schema impact:** None — query optimisation only, no model change.

  **Acceptance criteria**
  - `/api/projects` for a user with N projects issues exactly 1 membership query (not N+1)
  - A new `get_memberships_for_user(user_id, db)` (or equivalent) repository method returns
    all `ProjectMembership` rows for a user in one `SELECT … WHERE user_id = :uid` query
  - `_project_dict()` resolves role from the pre-fetched map without hitting the DB
  - All existing tests remain green

  **Unit tests:** `tests/test_repository.py` (same real-SQL-capture pattern as MNT-13's
  `test_apply_superadmin_emails_filtered_query` — a SQLAlchemy `before_cursor_execute`
  listener capturing actual emitted statements, not a mock) —
  - `test_get_memberships_for_user_single_query`: seed a user with N `ProjectMembership` rows
    across N projects; call the new `get_memberships_for_user(user_id, db)` method; assert
    exactly one `SELECT ... FROM project_memberships ... WHERE ... user_id ...` statement was
    captured (not N), and assert the returned map/dict contains all N project→role entries.
  - `test_project_list_resolves_roles_without_per_project_query`: call the `/api/projects`
    list path (or `_project_dict` directly) for a user with N projects; assert the total
    number of captured `SELECT`s against `project_memberships` is 1 regardless of N (e.g.
    parametrize N=1 and N=5 and assert the count doesn't grow with N).

  **E2E:** N/A (backend query optimisation; no UI surface change).

  **UAT:** N/A (non-UI; verified via unit test + PR review).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/ -q`

---

- [x] **MNT-11 — Named chart colour palettes selectable from `config.yml` (P1)**

  **Created:** 2026-06-28 · **Completed:** 2026-07-01

  Replace the hardcoded `PALETTE` constant in `charts.py` with a curated set of named,
  sober palettes suited to institutional/NGO reports (muted, desaturated, print-safe —
  not consumer SaaS brights). Users set `brand.palette: slate` in `config.yml`; the name
  resolves to a 10-colour sequence used across every chart type — multi-series charts
  (stacked/grouped bar, pie, donut, heatmap, likert, …) draw colours from the sequence in
  order; single-series charts use the first colour. Per-chart `color:` opt remains a working
  escape hatch. Projects without `brand.palette` fall back to the current default palette
  (no breaking change).

  **Design constraint — sober / institutional:** all palettes must be desaturated enough
  to read clearly in black-and-white print and on low-contrast screens. Reference aesthetic:
  UN, WFP, GIZ, World Bank data reports — not playful or brand-loud. Each palette leads
  with its strongest (darkest) hue and steps down in luminosity so series order is legible.

  **Proposed palettes (hex values are a starting point — implementer may refine within the
  sober constraint, but must not introduce saturated consumer-style colours):**

  - `slate`  (default — cool institutional blue/grey):
    `#1D3557, #2E6DA4, #5A8FC0, #8AAFD4, #BDD0E5, #4A5568, #718096, #A0AEC0, #CBD5E0, #E8EDF3`
  - `teal`   (humanitarian / health — WFP-adjacent):
    `#134E4A, #0F766E, #2A9D8F, #52B8AC, #8DD5CE, #3D6B65, #6A9E99, #A0C8C4, #CAE3E1, #EAF5F4`
  - `earth`  (field / food-security / development):
    `#5C3317, #8B5E3C, #B07D52, #C9A07A, #DEC4A4, #6B5B45, #957A5E, #BFA98E, #D9CBBA, #F0EAE0`
  - `indigo` (governance / protection — UNHCR-adjacent):
    `#1E2A5E, #2E4099, #5468C4, #8394D8, #B3BFEC, #4A5175, #7178A0, #A0A5C0, #CDD0E0, #ECEEF7`
  - `olive`  (environment / agriculture / resilience):
    `#2D3E1F, #4A6741, #6A9162, #8FB585, #B8D1B3, #5C5E3A, #888A5A, #B0B27A, #CCCFA0, #E8EAD2`

  **Files:** `src/reports/charts.py` · `src/utils/config.py` · `src/reports/builder.py` ·
  `sample.config.yml` · `docs/reference/config.md` · `tests/test_charts.py` ·
  `tests/test_builder.py`

  **Config/schema impact:** New optional `brand.palette` string field in `config.yml`.
  No migration needed — absent field falls back to default.

  **Acceptance criteria**
  - `charts.py` defines the 5 named palettes above (`slate`, `teal`, `earth`, `indigo`, `olive`),
    each a list of exactly 10 hex colours, all meeting the sober/institutional constraint
  - `config.py` exposes a `get_palette(cfg)` helper that returns the named palette list, or
    the default (`slate`) if `brand.palette` is absent or unrecognised
  - `builder.py` passes the resolved palette into the chart dispatch so all charts in a report
    share the same colour sequence
  - `_palette()` and `_color()` in `charts.py` accept an optional `palette` argument and use
    it instead of the module-level `PALETTE` constant
  - Per-chart `color:` opt still overrides the first slot as before
  - An unknown palette name logs a warning and falls back to `slate` (no crash)
  - `sample.config.yml` documents the `brand.palette` field with all five names and a one-line
    description of each palette's character

  **Unit tests:** `tests/test_charts.py`:
  - `test_palette_bar_uses_slate_sequence`: call `bar()` with `palette="slate"`; assert `r, g, b, _ = ax.patches[0].get_facecolor()` and `(round(r*255), round(g*255), round(b*255)) == (0x1D, 0x35, 0x57)`.
  - `test_palette_pie_uses_teal_sequence`: call `pie()` with `palette="teal"`; assert `r, g, b, _ = ax.patches[0].get_facecolor()` and `(round(r*255), round(g*255), round(b*255)) == (0x13, 0x4E, 0x4A)`.
  - `test_unknown_palette_falls_back_to_slate`: call `get_palette({"brand": {"palette": "nonexistent"}})`; assert result equals `PALETTES["slate"]` and use `with pytest.warns(UserWarning, match="unknown palette")` or `caplog.at_level(logging.WARNING)` to confirm a warning is emitted.
  - `test_get_palette_absent_returns_slate`: call `get_palette({})`; assert result equals `PALETTES["slate"]`.

  **E2E:** N/A (chart rendering is a Python-only path; no UI surface).

  **UAT:** N/A (non-UI; verified via unit tests + visual inspection of a sample report + PR review).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_charts.py -q` ·
  `PYTHONPATH=. MPLBACKEND=Agg python -m pytest -q`

---

- [x] **MNT-10 — Fix Tips card blank inline-code placeholders in `<Trans>` (P1)**

  **Created:** 2026-06-28 · **Completed:** 2026-06-28

  `sources.tip1` in both `en.json` and `fr.json` used empty tags (`<c1></c1>`, `<c2></c2>`).
  `react-i18next` `<Trans>` derives children from the translation string, so empty tags
  rendered `<code></code>` (blank box) instead of `<code>env:</code>` /
  `<code>env:KOBO_TOKEN</code>`. Fixed by moving the text inside the tags in both locales.

  **Files:** `frontend/src/locales/en.json` · `frontend/src/locales/fr.json`

  **Config/schema impact:** None — locale content only.

  **Acceptance criteria**
  - `sources.tip1` in both locales has `<c1>env:</c1>` and `<c2>env:KOBO_TOKEN</c2>`
  - Tips card renders the two `env:` code badges without blank boxes

  **Unit tests:** N/A (locale content fix; no logic changed).

  **E2E:** N/A (locale content fix).

  **UAT:** N/A (locale content fix; verified by visual inspection).

  **Verify:** Inspect the Tips card in the Sources tab — both `env:` badges render with text.

---

- [x] **MNT-9 — Translate chart hardcoded strings to project language (P1)**

  **Created:** 2026-06-28 · **Completed:** 2026-06-28

  Charts rendered by `charts.py` use hardcoded English strings for axis labels, table column
  headers ("Count", "Percent", "Value", "Frequency", etc.), and fallback titles.
  When `ai.language` in `config.yml` is set to a non-English language (e.g. "French"),
  these strings remain in English, creating a mixed-language report.
  Fix: thread `ai.language` from the config into the chart dispatch and translate the finite set
  of hardcoded strings via a small lookup dict (at minimum: French; graceful English fallback for
  unknown languages).

  **Files:** `src/reports/charts.py` · `src/reports/builder.py`

  **Config/schema impact:** None — reads existing `ai.language` field, no schema change.

  **Acceptance criteria**
  - All hardcoded English column headers and axis labels in `charts.py` ("Count", "Percent",
    "Value", "Frequency", "Category", "Score", "Rank") are translated when
    `ai.language` is "French"
  - `builder.py` passes `ai.language` into the chart dispatch call
  - Unknown / unsupported languages fall back to English (no crash)
  - All existing tests remain green

  **Unit tests:** `tests/test_charts.py` — for at least two chart types (`bar`, `table`):
  - `test_bar_chart_french_axis_labels`: call `bar()` with `language="French"`; assert `ax.get_xlabel()` or `ax.get_ylabel()` contains the French translation (e.g. `"Nombre"` not `"Count"`).
  - `test_table_chart_french_column_headers`: call `table()` with `language="French"`; assert the column header text in the rendered table contains `"Nombre"` and `"Pourcentage"` instead of `"Count"` and `"Percent"`.
  - `test_unknown_language_falls_back_to_english`: call with an unsupported language; assert no exception and English strings are used.

  **E2E:** N/A (chart rendering is a Python-only path; no UI surface).

  **UAT:** N/A (non-UI fix; verified via unit test + PR review).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_charts.py -q` ·
  `PYTHONPATH=. MPLBACKEND=Agg python -m pytest -q`

---

- [x] **MNT-8 — Strip residual `[[` `]]` delimiters from built report output (P1)**

  **Created:** 2026-06-28 · **Started:** 2026-07-01 · **Completed:** 2026-07-01

  After `docxtpl` renders the Word template, any `[[...]]` tokens that were not resolved by
  the Express Fill pipeline remain in the output docx with their raw brackets (e.g. `[[NOM]]`
  renders literally in the document). The fix is a post-render pass in `builder.py` that opens
  the just-written `.docx`, iterates all paragraphs + table cells, and replaces the pattern
  `[[<inner>]]` with `<inner>` in every run's text, then saves.

  **Files:** `src/reports/builder.py`

  **Config/schema impact:** None — behaviour fix only.

  **Acceptance criteria**
  - After `build_report` completes, no paragraph or table cell in the output `.docx` contains
    the literal substrings `[[` or `]]`
  - Inner text is preserved: `[[NOM]]` → `NOM`, `[[LISTE DES PARTENAIRES]]` → `LISTE DES PARTENAIRES`
  - Existing `{{ }}` Jinja2 placeholders that were properly filled are unaffected
  - All existing tests remain green

  **Unit tests:** `tests/test_builder.py`:
  - `test_no_double_bracket_open_in_output` / `test_no_double_bracket_close_in_output`: template with `[[NOM]]` in a paragraph → assert output contains `NOM`, does not contain `[[` or `]]`.
  - `test_multiword_token_inner_text_preserved` / `test_nom_token_inner_text_preserved`: template with `[[LISTE DES PARTENAIRES]]` → assert `LISTE DES PARTENAIRES` is preserved.
  - `test_strip_token_split_across_runs`: constructs a docx where `[[` and `NOM]]` are two genuinely separate python-docx `Run` objects in the same paragraph; asserts post-render stripping still works. **Note:** confirmed this specific split point (delimiter intact within a single run) works because `_clean_runs` strips per-run; a stricter split with a delimiter *character* itself broken across runs is NOT covered here — tracked separately as MNT-14.
  - `test_jinja2_filled_values_unaffected`: template with a normally-filled `{{ report_title }}` → assert it resolves correctly and no `[[` artifacts appear.

  **E2E:** N/A (no new UI surface; behaviour is in the Python report-build path).

  **UAT:** N/A (non-UI fix; verified via unit test + PR review).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_builder.py -q` ·
  `PYTHONPATH=. MPLBACKEND=Agg python -m pytest -q`

---

- [x] **MNT-7 — Fix Express Fill silent empty state when LLM response is malformed (P1)**

  **Created:** 2026-06-28 · **Started:** 2026-06-28 · **Completed:** 2026-06-30

  `infer_specs` in `src/reports/template_inference.py` (line 300) silently `return []`
  when the LLM response can't be parsed as `{"proposals": [...]}`. The endpoint's outer
  `except Exception` never fires, so it returns `{"proposals": [], "message": null}`, and
  the frontend renders "Aucun espace réservé à examiner." (empty placeholder state) instead
  of an error. Fix: raise `RuntimeError` with the raw snippet so the endpoint returns HTTP 500
  and the frontend shows a real error message. Add an E2E test that stubs `/api/template/infer`
  to return 500 and asserts the error is shown (not the empty-placeholder state).

  **Files:** `src/reports/template_inference.py` (line 300) · `frontend/src/pages/Templates.jsx` · `frontend/tests/e2e/express-template-fill.spec.ts` · `tests/test_api_template.py`

  **Config/schema impact:** None — behaviour fix only.

  **Acceptance criteria**
  - `infer_specs` raises `RuntimeError` (not `return []`) when `_loads_lenient(raw)` does not
    produce a `{"proposals": list}` structure
  - The `/api/template/infer` endpoint returns HTTP 500 with `detail` set when `infer_specs` raises
  - `frontend/src/pages/Templates.jsx` renders an element with class `express-error` (visible via `role="alert"`) when the infer response is non-2xx; the element is absent on success
  - When `/api/template/infer` returns HTTP 500, the Templates tab displays an error banner and does NOT display the empty-placeholder state ("Aucun espace réservé à examiner.")
  - The error state renders correctly at mobile/tablet/desktop viewports (screenshot baselines committed)
  - All existing tests remain green

  **Unit tests:**
  `tests/test_template_inference.py`:
  - `test_infer_specs_raises_on_malformed_json`: `lf_client.chat` returns a non-JSON string; assert `infer_specs` raises `RuntimeError`.
  - `test_infer_specs_raises_on_missing_proposals_key`: `lf_client.chat` returns `{"result": []}`; assert `infer_specs` raises `RuntimeError` (boundary: `_loads_lenient` succeeds but the `proposals` key is absent).

  `tests/test_api_template.py` (new or extend existing):
  - `test_infer_endpoint_returns_500_when_infer_specs_raises`: using `TestClient`, patch `infer_specs` to raise `RuntimeError("LLM response malformed")`; POST to `/api/template/infer`; assert response status is 500 and `detail` is non-null.

  **E2E:** `frontend/tests/e2e/express-template-fill.spec.ts` — new describe block or test:
  - Stub `**/api/template/infer` to return 500 with `{"detail": "infer failed: LLM response malformed"}`
  - Click banner → upload → infer → assert `.express-error` is visible with the error text
  - Assert the empty-placeholder state (`templates.noPlaceholders`) is NOT rendered
  - `toHaveScreenshot('express-infer-error.png')` at all three viewports
  - After baselines are committed, run `npx impeccable audit` + `npx impeccable critique` and confirm no new regressions are flagged on the error-state view

  **UAT:**
  *(The E2E test owns the HTTP-500-stub assertion and screenshot baselines. UAT verifies the error-display behavior in a real browser.)*
  1. Review the committed E2E screenshots (`express-infer-error.png` at mobile/tablet/desktop) and confirm the error banner is legible and the empty-placeholder state is absent.
  2. Open the Templates tab → click the Express Fill banner. Upload a `.docx` template.
  3. In browser DevTools → Network → select the **Overrides** tab → enable **Override content** for `/api/template/infer` → set the response body to `{"detail": "infer failed: LLM response malformed"}` and status to 500. Click **Infer**.
  4. Confirm an error message is displayed — NOT the "Aucun espace réservé à examiner." empty state.
  5. Disable the override. Confirm a normal infer run succeeds (proposals list appears).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_template_inference.py tests/test_api_template.py -q` ·
  `cd frontend && npm run test:e2e -- --grep "infer.*error|error.*infer"` ·
  `cd frontend && npm run test:e2e` (full suite green) ·
  `PYTHONPATH=. MPLBACKEND=Agg python -m pytest -q` (full suite green)

---

- [x] **MNT-6 — Remove dead code (components, exports, imports) (P3)**

  **Created:** 2026-06-28 · **Completed:** 2026-06-28

  Audit and remove unused exports, components, functions, and imports across `frontend/src/`
  and `src/` + `web/`. Known candidate: `frontend/src/components/PeriodPicker.jsx` is defined
  but never imported anywhere. No behaviour change — all tests must stay green after removal.

  **Files:** `frontend/src/components/PeriodPicker.jsx` (delete) · any other dead code found
  during the audit across `frontend/src/`, `src/`, and `web/`.

  **Config/schema impact:** None — removals only; no behaviour change.

  **Acceptance criteria**
  - `PeriodPicker.jsx` is deleted (confirmed never imported anywhere)
  - Any other unused exports, components, functions, or imports found in the audit are removed
  - `npm run build` succeeds after removals (no dangling imports)
  - The full pytest suite (`PYTHONPATH=. MPLBACKEND=Agg python -m pytest -q`) stays green
  - No behaviour regression: the app works identically for all user flows

  **Unit tests:** N/A (removal-only; the verification is the full test suite staying green).

  **E2E:** N/A (no UI surface change — the removed code is unused by definition).

  **UAT:** N/A (no UI surface — verified via build + test suite green + PR review).

  **Verify:** `cd frontend && npm run build` · `PYTHONPATH=. MPLBACKEND=Agg python -m pytest -q`

---

- [x] **MNT-5 — Guard period API fetches when no project is active (P2)**

  **Created:** 2026-06-27 · **Completed:** 2026-06-28

  `ActivePeriodChip` (`App.jsx`), `PeriodPicker` (`PeriodPicker.jsx`), `Reports.jsx`, and
  `Sources.jsx` all call `/api/periods` or `/api/periods/date-range` on mount. Before the
  user activates a project `_load_cfg()` on the server raises 400 (`"No active project"`),
  producing console errors. Each call site must skip the fetch when `activeProjectId` is
  null/undefined.

  **Files:**
  - `frontend/src/App.jsx` (`ActivePeriodChip`, ~lines 102–118)
  - `frontend/src/components/PeriodPicker.jsx` (~line 11)
  - `frontend/src/pages/Reports.jsx` (~line 80)
  - `frontend/src/pages/Sources.jsx` (~line 896)

  **Config/schema impact:** None — client-side guard only.

  **Acceptance criteria**
  - Opening the app without an active project produces **zero** 400 errors for
    `/api/periods` or `/api/periods/date-range` in the browser console
  - When a project is activated the period chips and pickers load normally
  - No visible regression: period data loads correctly when a project is active
  - All four call sites are guarded consistently

  **Unit tests:** N/A (frontend-only; Vitest not installed — covered by Playwright E2E).

  **E2E:** `frontend/tests/e2e/no-active-project.spec.ts` — intercept `/api/me` to return
  a user with `active_project_id: null`; assert no requests reach `/api/periods` or
  `/api/periods/date-range`. `toHaveScreenshot` baselines at all three viewports.

  **UAT:**
  1. Open the app with network devtools open before any project is active (fresh session or
     cleared local storage).
  2. Confirm no 400 errors appear in the console for `/api/periods`.
  3. Select a project. Confirm period chips and pickers load without errors.

  **Verify:** `cd frontend && npx playwright test no-active-project.spec.ts`

---

- [x] **MNT-4 — Fix Toast crash: i18n `t` shadowed by the toasts.map variable (P1)**

  **Created:** 2026-06-26 · **Completed:** 2026-06-27

  `frontend/src/components/Toast.jsx` destructures the i18n function as `t`
  (`const { t } = useTranslation()`), then renders `toasts.map(t => …)` — the map
  parameter **shadows** the translation function. Inside the map, the dismiss
  button calls `aria-label={t('components.toast.dismiss')}`, which now invokes the
  toast object as a function → `TypeError: t is not a function`, crashing
  `ToastProvider` and blanking the whole app (no error boundary). It triggers
  whenever **any** toast renders — e.g. "Try with sample data" and "Create project"
  both fire a success toast. Regression from the i18n toast externalization.
  Fix: rename the `toasts.map` parameter (e.g. `item`) so `t(...)` resolves to the
  translation function; no behaviour/markup change otherwise.

  **Files:** `frontend/src/components/Toast.jsx` ·
  `frontend/tests/e2e/toast-i18n.spec.ts` (new)

  **Config/schema impact:** None — frontend bug fix only.

  **Acceptance criteria**
  - Rendering one or more toasts does NOT throw; `ToastProvider` mounts and the app
    stays interactive (no blank page / uncaught `TypeError`)
  - Each toast's dismiss control has a non-empty accessible name from
    `components.toast.dismiss` (the i18n `t` resolves correctly inside the map)
  - Triggering a toast via a real user action (e.g. load sample data, or create a
    project) shows the toast and leaves the page rendered (root not emptied)
  - No raw i18n key leaks; en/fr remain key-aligned (`check:i18n` passes)
  - No change to toast behaviour, styling, timing, or markup beyond the variable rename

  **Unit tests:** N/A (frontend-only; Vitest not installed — asserted by the Playwright E2E below).

  **E2E:** `frontend/tests/e2e/toast-i18n.spec.ts` (new) — load the app (network-mocked,
  same harness as connection-gating), perform an action that fires a toast, and assert:
  (a) no `pageerror` occurs, (b) the toast (`[role="status"]`/`[role="alert"]`) is visible,
  (c) its dismiss button exposes a non-empty accessible name, and (d) the `#root` still has
  content (app not blanked). A regression guard run against the unpatched component must fail.
  (No new `toHaveScreenshot` baseline required — behavioural fix, not a visual change.)

  **UAT:**
  1. Create a new project and confirm the success toast appears and the app does NOT go blank.
  2. On Extract → Connection, click "Try with sample data" and confirm the toast appears with no crash.
  3. Confirm the toast's ✕ dismiss button is reachable/announced and dismisses the toast.

  **Verify:** `cd frontend && npx playwright test toast-i18n.spec.ts && npm run check:i18n`

---

- [x] **MNT-3 — I18N-1 backend hygiene: double-commit + verbatim Zitadel error (P3)**

  **Created:** 2026-06-26 · **Completed:** 2026-06-27

  Two Low items from the I18N-1 security review. (a) `PATCH /api/me` commits twice — `set_user_language()`
  commits internally and `patch_me` commits again (redundant). (b) The Zitadel sync error path echoes the
  raw exception verbatim in the PATCH response (could embed internal URLs). Single commit site + sanitize
  the message.

  **Files:** `web/main.py` (`patch_me`) · `web/db/repository.py` (`set_user_language`) ·
  `tests/test_profile_api.py`

  **Config/schema impact:** None.

  **Acceptance criteria**
  - `PATCH /api/me` commits exactly once (no redundant commit/refresh); behavior unchanged
  - The Zitadel error path returns a sanitized message (no raw exception/internal URL) in the response
  - Existing profile/language tests still pass (no regression to I18N-1)

  **Unit tests:** `tests/test_profile_api.py` — a language PATCH persists via a single commit path
  (behavior unchanged); a simulated Zitadel sync error yields a sanitized (non-verbatim) message.

  **E2E:** N/A (backend).

  **UAT:** N/A (verified via the Verify command + the verifier + PR review).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_profile_api.py tests/test_profile_language.py`

---

- [x] **MNT-2 — Clear dev-dependency CVEs (vite High + esbuild Moderate) (P2)**

  **Created:** 2026-06-26 · **Completed:** 2026-06-27

  `npm audit` flags pre-existing advisories in the frontend DEV toolchain: vite (High — needs >= 8.1) +
  esbuild (Moderate — needs >= 0.25, dragged by the vite bump). Dev-only (not in the shipped bundle) but
  should be cleared. Bump + verify the dev server, Playwright harness, and build still work.

  **Files:** `frontend/package.json` · `frontend/package-lock.json` · possibly
  `frontend/vite.config.*` / `frontend/playwright.config.ts` (if the major bump needs config changes)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - vite + esbuild bumped to versions with no outstanding High/Moderate advisory (npm audit clear for them)
  - `npm run build` succeeds; the Vite dev server serves; the Playwright e2e harness runs
  - No app/runtime behavior change (visual baselines unaffected, or refreshed + human-approved if the
    toolchain bump shifts rendering)

  **Unit tests:** N/A (dependency/toolchain chore).

  **E2E:** the existing Playwright suite is the regression check — must stay green post-bump (no new
  baselines expected; flag + human-approve any genuine drift).

  **UAT:** N/A (verified via build + e2e green + dep-audit clean + PR review).

  **Verify:** `cd frontend && npm audit` (vite/esbuild cleared) · `npm run build` · `npm run test:e2e`

---

- [x] **MNT-1 — Stabilize the order-dependent ask-save indicator test (P2)**

  **Created:** 2026-06-26 · **Completed:** 2026-06-27

  `tests/test_ask_api.py::test_ask_save_indicator_appends_to_indicators` passes in the full suite but
  FAILS run in isolation — a test-isolation/ordering bug (leaked shared/config state). Pre-existing on
  `develop`. Make it deterministic regardless of run order.

  **Files:** `tests/test_ask_api.py` (+ the fixture / module-level state it depends on)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - The named test passes RUN ALONE
  - It also passes in the full suite (no regression)
  - Root cause (leaked state) fixed at the fixture/isolation level, not by reordering

  **Unit tests:** the card IS a pytest-stability fix — covered by running the named test in isolation
  then in the full file.

  **E2E:** N/A (backend test-infra).

  **UAT:** N/A (verified via the Verify command + the verifier + PR review).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_ask_api.py::test_ask_save_indicator_appends_to_indicators` (alone), then `tests/test_ask_api.py`

---

