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

- [x] **MNT-21 — Fix: bullet_list chart preview fails instead of rendering text (P1)**

  **Created:** 2026-07-04 · **Started:** 2026-07-05 · **Completed:** 2026-07-05

  The `/api/charts/preview` endpoint always falls through to `generate_chart`/`CHART_DISPATCH`
  for every chart type, but `bullet_list` is text-injection only — it's special-cased in
  `builder.py` at report-build time and was never added to `CHART_DISPATCH`. Selecting
  `bullet_list` in the Composition chart editor and previewing it failed with a generic error
  instead of showing the rendered bullet text. Fixed by short-circuiting `bullet_list` in
  `preview_chart` (`web/main.py`) to mirror `builder.py`'s text-building logic, exposing the text
  field through the frontend preview hook, and rendering text (not an `<img>`) in both the
  row-preview modal and the live chart-editor pane. Also fixes a related empty-state bug: a
  successful-but-empty `bullet_list` result (the chosen column has zero non-null values) rendered
  as the idle "Preview appears here" placeholder — indistinguishable from "not configured yet" —
  instead of an explicit "no output" empty state.

  **Note:** this card's branch predates VIS-9/VIS-11/VIS-12 (the visual-review migration) by 23
  commits. Rebased onto post-migration `develop` on 2026-07-05; its one new chart-editor visual
  baseline (`chart-editor-modal-bullet-list.png`) was moved from the (pre-migration, now stale)
  colocated location straight into `visual-review/specs/chart-editor.visual.spec.ts`, matching
  VIS-12's established split contract, rather than landing in the now-functional-only
  `frontend/tests/e2e/chart-editor.spec.ts`.

  **Type:** Fix

  **Files:** `web/main.py` (`preview_chart` — add a `bullet_list` short-circuit mirroring
  `builder.py`'s text-building logic) · `frontend/src/hooks/useChartPreview.js` (expose the text
  field) · `frontend/src/pages/Composition.jsx` (render text instead of an `<img>` for
  `bullet_list` in both the row-preview modal and the live editor pane; add the explicit
  empty-result branch) · `tests/test_charts_preview_api.py` (new) ·
  `frontend/tests/e2e/chart-editor.spec.ts` (new functional empty-state test) ·
  `visual-review/specs/chart-editor.visual.spec.ts` (new visual baseline, post-rebase)

  **Config/schema impact:** None — preview-endpoint + rendering logic only; no `config.yml` or DB
  schema change (mirrors the existing `builder.py` text-rendering path for `bullet_list`).

  **Acceptance criteria**
  - Selecting `bullet_list` as the chart type in the Composition chart editor and configuring a
    column renders the live preview as text (bulleted lines), not a failed/broken image request
  - The same applies to the row-level "Preview" action in the Composition chart list
  - A `bullet_list` preview whose result is a successful-but-empty string shows an explicit
    "no output" empty state, distinguishable from the idle "not configured yet" placeholder
  - Non-`bullet_list` chart types are unaffected (still render an `<img>` preview) — no regression
  - `cd frontend && npx playwright test chart-editor` passes, including the new empty-state test

  **Unit tests:** `tests/test_charts_preview_api.py` (new) —
  `test_preview_bullet_list_returns_text`, `test_preview_bullet_list_respects_top_n`,
  `test_preview_bar_chart_still_returns_image` (regression guard). Run:
  `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_charts_preview_api.py`.

  **E2E:** `frontend/tests/e2e/chart-editor.spec.ts` (extend) — the empty-result guard test (no
  screenshot, functional only); `visual-review/specs/chart-editor.visual.spec.ts` (extend) — the
  `bullet_list` preview visual baseline at all three viewports, per VIS-12's split contract.

  **UAT:** N/A (bug fix restoring correct preview behavior for an existing chart type; no new
  product surface — PR review + the pytest/Playwright cases above are the human gate).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_charts_preview_api.py` ·
  `cd frontend && npx playwright test chart-editor`

---

- [x] **MNT-22 — Fix: stale "Transform" nav-label assertions in i18n-switch.spec.ts + a11y-4.spec.ts break deterministically on current develop (P1)**

  **Created:** 2026-07-04 · **Completed:** 2026-07-04

  PUX-1/PUX-8 relabeled the pipeline stage previously called "Transform" to the plain-language
  "Clean & check" (`frontend/src/locales/en.json` / `fr.json`), but two Playwright specs
  predating that rename were never updated: `frontend/tests/e2e/i18n-switch.spec.ts`'s `NAV_EN`/
  `NAV_FR` constants still assert the literal tab labels `'Transform'`/`'Transformer'`, and
  `frontend/tests/e2e/a11y-4.spec.ts`'s `gotoValidate()` helper clicks
  `.tabs-bar .tab { hasText: 'Transform' }`. Since no tab named "Transform" renders anywhere in
  the current app, both fail deterministically — reproduced on a clean `develop` checkout,
  confirmed unrelated to any other in-flight work. This is a real, pre-existing bug (not a
  flake), discovered while investigating unrelated `/ship-task` failures on VIS-11/VIS-12: the
  batch pipeline's review agents correctly reported these tests failing, but the root cause is
  this stale-label mismatch, not a defect in VIS-11/VIS-12's own spec-split diffs. Every other
  file that mentions "Transform" (`client-cache.spec.ts`, `perf-3-skeleton.spec.ts`,
  `sample-data-path.spec.ts` — all navigate via the stable `[data-tab="transform"]` attribute;
  `i18n-subtabs.spec.ts` — navigates via the stage id, not the label; `pux-1.spec.ts` —
  intentionally asserts the bare jargon word is *absent*; `i18n-guard-navlabels.spec.ts` — a
  fully self-contained fixture test with its own synthetic locale bundles, unrelated to the real
  app's actual labels) was individually checked and confirmed **not** affected by this bug.

  **Type:** Fix

  **Files:** `frontend/tests/e2e/i18n-switch.spec.ts` (`NAV_EN`/`NAV_FR` constants ~line 49-50,
  plus the stale "Transform" mentions in the doc comment ~lines 11, 41, 48) ·
  `frontend/tests/e2e/a11y-4.spec.ts` (`gotoValidate()` helper ~line 169-173, switch the click
  target from `hasText: 'Transform'` to the stable `[data-tab="transform"]` attribute, matching
  the convention already used by `client-cache.spec.ts`/`perf-3-skeleton.spec.ts`)

  **Config/schema impact:** None — test-file content fix only, no application code changes.

  **Acceptance criteria**
  - `i18n-switch.spec.ts`'s `NAV_EN`/`NAV_FR` assert the current labels (`'Clean & check'`/
    `'Nettoyer et vérifier'`, alongside the unchanged `'Deliver'`/`'Diffuser'`), not the stale
    `'Transform'`/`'Transformer'`
  - `a11y-4.spec.ts`'s `gotoValidate()` navigates via `[data-tab="transform"]` (the stable
    attribute), not the visible label text
  - `cd frontend && npx playwright test i18n-switch a11y-4` passes at all three viewports with
    zero failures (confirmed: 27/27 passing after the fix)
  - `cd frontend && npx playwright test i18n-coverage i18n-remaining i18n-subtabs i18n-switch a11y-4`
    passes with zero failures (confirmed: 135/135 passing after the fix)
  - No other file's behavior changes — the audit of every other "Transform"-mentioning file
    confirmed none of them needed a fix

  **Unit tests:** N/A (frontend-only test-file content fix; Vitest is not installed — correctness
  is exactly what the Playwright specs below assert, per the XTF-7 precedent).

  **E2E:** `frontend/tests/e2e/i18n-switch.spec.ts` + `frontend/tests/e2e/a11y-4.spec.ts` — both
  green at all three viewports after the fix; no new spec or baseline (these are pre-existing
  specs whose *assertions* were fixed, not their captured pixels — no visual regression).

  **UAT:** N/A (test-content fix restoring pre-existing, already-approved specs to a passing
  state; no product UI or behavior changed — PR review + the green Playwright run above are the
  human gate).

  **Verify:** `cd frontend && npx playwright test i18n-switch a11y-4` ·
  `cd frontend && npx playwright test i18n-coverage i18n-remaining i18n-subtabs i18n-switch a11y-4`

---

- [x] **MNT-20 — Prompt guidance: tell the LLM when to use `bullet_list` instead of `table` (Express Fill inference) (P1)**

  **Created:** 2026-07-04 · **Completed:** 2026-07-04

  MNT-19 made `bullet_list` a technically valid, proposable AI-inference type — confirmed at the
  code level (`ask_engine._CHART_TYPES_BLOCK` genuinely includes it). But the LLM never picks it:
  `template_inference.py`'s `_KINDS` tuple (`"chart", "indicator", "summary", "table", "narrative",
  "metadata", "split_value"`) is presented to the LLM as the primary, flat list of top-level
  choices — `bullet_list` isn't one of them, it's only reachable two steps deep
  (`kind="chart"` → `spec.type="bullet_list"` from a separate "chart types" list). The prompt's
  per-kind guidance (`seed_prompts.py`'s `_TEMPLATE_INFERENCE`, `table` bullet at line 980) never
  mentions this path or redirects the LLM to it when a table's "≥1 categorical column"
  requirement can't be met — so a French list-style placeholder (e.g. `actions_prioritaires`)
  with no categorical column keeps getting proposed as `table` (which then fails validation)
  instead of `bullet_list`, confirmed live by re-running Infer after MNT-19 merged.

  **Type:** Fix

  **Files:** `src/utils/seed_prompts.py` (`_TEMPLATE_INFERENCE` system message ~lines 953-963 and
  the user message's `table` bullet ~line 980) · `tests/test_seed_prompts.py` (new test)

  **Config/schema impact:** None — prompt text only; `_TEMPLATE_INFERENCE_SPEC_SCHEMA`'s `type`
  field already accepts any string (no enum constraint to update).

  **Acceptance criteria**
  - `_TEMPLATE_INFERENCE`'s system message explicitly states that `bullet_list` is not a real
    chart/graph and should be preferred over `table` when there's no categorical column
  - `_TEMPLATE_INFERENCE`'s user message's `table` bullet explicitly redirects to
    `kind="chart"` + `type="bullet_list"` when there's no categorical column
  - No change to the JSON output schema — this is prompt-text-only
  - `test_no_leftover_single_brace_format_slots` (existing) stays green — no stray `{var}`
    introduced

  **Unit tests:** `tests/test_seed_prompts.py` (new) —
  `test_template_inference_explains_bullet_list_over_table`: asserts the `_TEMPLATE_INFERENCE`
  system message mentions `bullet_list` in the context of not being a real chart, and the user
  message's table description redirects to `bullet_list` when there's no categorical column.

  **E2E:** N/A (no UI surface — prompt text consumed only by an LLM call).

  **UAT:** N/A (backend prompt-text-only change; behavior against a live LLM is exploratory/
  non-deterministic and not gated by a fixed human checklist — validated by the unit test above
  and PR review).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_seed_prompts.py -k bullet_list` ·
  Optional manual smoke-check after merge (not gated, since LLM behavior is non-deterministic):
  (1) run `push-prompts --force` to push the updated prompt to Langfuse (required — Langfuse
  already holds a prior copy and always wins over the seed once populated); (2) clear the
  on-disk prompt cache (`rm -rf ~/.cache/databridge/prompts`, or wait out its 1-hour TTL — a
  backend process restart does NOT clear this disk-based cache); (3) re-run Infer on a template
  with a list-style placeholder with no categorical column and confirm it now proposes
  `kind="chart"`, `type="bullet_list"` instead of `table`.

---

- [x] **MNT-19 — Add `bullet_list` as a proposable AI-inference type (stop over-defaulting free-text/list placeholders to `table`) (P2)**

  **Created:** 2026-07-04 · **Completed:** 2026-07-04

  Express Template Fill's AI inference has no way to propose `bullet_list` (a first-class render
  type since XTF-27 — "1 column to list as bullet points", `Composition.jsx:40`) because
  `ask_engine.py`'s `CHART_REQS` (the dict shared by both `/api/ask` and Template Inference's
  `validate_recipe()`) has no `bullet_list` entry at all. When a placeholder's name/content is
  really a free-text list (e.g. French names like `actions_prioritaires`,
  `interventions_manquantes`, `risques_doublons` — "priority actions", "missing interventions",
  "duplicate risks") and the underlying data has no categorical column, the LLM has nowhere
  correct to route it: narrative-slot routing in `annotate_proposals`
  (`_NARRATIVE_SLOT_KEYWORDS`, `template_inference.py:239-243`) only covers a fixed keyword set
  (findings, overview, next steps, recommendations, observations, etc.), and the LLM-facing prompt
  description of "narrative" (`seed_prompts.py:981-983`) similarly only mentions "recommendations,
  observations, an executive summary" — neither matches these names, so the model falls back to
  `table`, the generic catch-all, which then permanently fails `table`'s "≥1 categorical column"
  requirement (`ask_engine.py` `CHART_REQS["table"]`) and gets stuck on a `needs_attention`
  warning the user has to manually reassign every time.

  Adding `bullet_list` to `CHART_REQS` alone is not sufficient: `apply_inference`
  (`template_inference.py`, `_KIND_SECTION` + the canonical-placeholder construction around lines
  777-778 and 912-915) always writes back `{{ chart_<name> }}` for `kind == "chart"` regardless
  of `spec["type"]`, but `builder.py` (~line 450-451) only ever populates a `list_<name>` context
  key for `type == "bullet_list"` — so an approved `bullet_list` proposal would silently never
  render unless the placeholder-naming logic is also taught the `bullet_list` → `list_<name>`
  mapping already used for manually-added bullet_list placeholders
  (`template_generator.py:31-32,137,226`).

  **Scope grew during Review** (security-audit, 3 passes): `bullet_list` renders raw, unaggregated
  per-row values of a column (unlike every other proposable type, which renders aggregates), so
  making it AI-proposable turned a pre-existing gap — `/api/ask/save` and `/api/template/apply`
  persisted a client/LLM-supplied chart spec with no server-side re-validation against
  `is_pii`/`is_effective_hidden` — into a full raw-data exfiltration path for a PII-flagged column
  not separately listed in `cfg.pii.redact`. Closed with a PII/hidden-column gate at both
  persistence endpoints (not just the propose paths), the CLI's `cmd_infer_template`, and a
  negative-`top_n` cap bypass. The resulting synchronous profile recompute on every Save/Apply
  click then tripped `perf-review` (`PERF: BLOCKED`) — fixed by routing both endpoints through the
  existing `perf_cache` mechanism `/api/profile` already uses, empirically verified to cache-hit
  correctly and to bust on a `cfg` (PII-flag) change.

  **Type:** Fix

  **Files:** `src/reports/ask_engine.py` (`CHART_REQS["bullet_list"]`; `_validate_chart`'s
  bullet_list branch gates on `excluded_column_names(cfg)`; `validate_recipe`/`_execute_item`/
  `ask()`/`refine_item()` thread an optional `cfg` param) · `src/reports/template_inference.py`
  (`_KIND_SECTION` / canonical-placeholder construction ~lines 777-778, 912-915 route
  `bullet_list` to the `list_<name>` prefix; `annotate_proposals`/`_validate_data_proposal` thread
  `cfg`) · `src/reports/charts.py` (`build_bullet_list_text` gains `opts.get("top_n", 50)` capped
  via `max(0, top_n)`) · `src/reports/builder.py` (passes `resolved.get("options")` through) ·
  `src/data/make.py` (`cmd_infer_template` passes `cfg` into `annotate_proposals`) ·
  `web/main.py` (`_bullet_list_names_excluded` helper; `api_ask_save` validates via
  `ask_engine.validate_recipe(..., cfg)` before persisting, routed through the existing
  `perf_cache` under the same `"profile"` key `/api/profile` uses; `api_template_apply`
  re-validates via `ti.annotate_proposals(candidates, prof, cfg)` server-side instead of trusting
  client-echoed `status`, same cache treatment) · `tests/test_ask_engine.py`,
  `tests/test_template_inference.py`, `tests/test_ask_api.py`, `tests/test_template_api.py`,
  `tests/test_xtf27_bullet_list.py` (new tests) · `docs/reference/prompts.md` (checked — no
  proposable-type enumeration exists there to update)

  **Config/schema impact:** None — `bullet_list` the render type already exists and is unchanged
  (XTF-27); this only changes what the AI recipe validator/prompt can propose, how that
  proposal's placeholder is named when applied, and adds a server-side PII/hidden-column
  re-validation gate at persistence time.

  **Acceptance criteria**
  - `CHART_REQS` in `ask_engine.py` includes a `"bullet_list"` entry with requirement "≥1 column"
  - `validate_recipe()` accepts a `bullet_list` recipe with ≥1 column and rejects one with 0
    columns, using the same requirement-string format as other types (e.g. "'bullet_list' needs
    ≥1 column")
  - The AI type-list prompt block includes `bullet_list` alongside the other proposable types, so
    both `/api/ask` and Express Template Fill's inference can propose it
  - Given a placeholder whose underlying data has no categorical column but does have at least
    one usable column, Template Inference's batched call can propose `bullet_list` instead of
    being forced toward the always-failing `table`
  - A `bullet_list` proposal approved via Express Template Fill's `apply_inference` writes
    `{{ list_<name> }}` into the resolved template (not `{{ chart_<name> }}`), matching
    `builder.py`'s `list_<name>` context key — the same convention `template_generator.py` already
    uses for a manually-added bullet_list placeholder
  - A `bullet_list` recipe naming a column flagged `is_pii`/effectively hidden is rejected — at
    `/api/ask` and `/api/template/infer` (propose time) AND at `/api/ask/save` and
    `/api/template/apply` (persistence time, independent of any client-supplied `status`), and at
    the CLI's `infer-template`/`apply-template` path
  - A negative `top_n` on a `bullet_list` no longer bypasses its row cap (`max(0, top_n)`)
  - `api_ask_save`/`api_template_apply`'s new profile-loading work is served from the existing
    `perf_cache` (same key `/api/profile` uses) rather than recomputing on every request, and the
    cache correctly busts when `cfg` changes (e.g. a column's `pii:` flag flips)
  - No regression to existing chart/indicator/summary/table/narrative/metadata routing,
    validation, or placeholder-naming — all existing `ask_engine`/`template_inference` tests
    remain green

  **Unit tests:** `tests/test_ask_engine.py` — `test_validate_recipe_bullet_list_needs_one_column`,
  `test_validate_recipe_bullet_list_rejects_pii_column`,
  `test_validate_recipe_bullet_list_rejects_hidden_column`,
  `test_validate_recipe_bullet_list_allows_safe_column_with_cfg`.
  `tests/test_template_inference.py` — `test_annotate_bullet_list_proposal_validates_ok`,
  `test_apply_inference_bullet_list_uses_list_prefix`.
  `tests/test_ask_api.py` — `test_ask_save_rejects_pii_bullet_list_with_data`,
  `test_ask_save_rejects_pii_bullet_list_without_data`.
  `tests/test_template_api.py` — `test_apply_revalidates_and_drops_flipped_pii_bullet_list`,
  `test_apply_drops_pii_bullet_list_without_data`.
  `tests/test_xtf27_bullet_list.py` — `test_bullet_list_negative_top_n_still_caps`.

  **E2E:** N/A (no app UI surface changed — Composition.jsx's manual `bullet_list` option already
  exists per XTF-27; this card only changes what the AI can *propose* during inference, how that
  proposal is named when applied, and server-side validation/caching, none of it UI).

  **UAT:** N/A (backend/AI-inference + API logic; PR review + the unit tests above are the human
  gate).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_ask_engine.py tests/test_template_inference.py tests/test_ask_api.py tests/test_template_api.py tests/test_xtf27_bullet_list.py -k bullet_list`

---

- [x] **MNT-18 — Add `{{ year }}` / `{{ month }}` / `{{ day }}` date-component placeholders (P2)**

  **Created:** 2026-07-04 · **Completed:** 2026-07-04

  The report builder only exposes one composed timestamp, `{{ generated_at }}`
  (`"%d/%m/%Y %H:%M"`, `src/reports/builder.py` `_render()` line 336), with no way for a Word
  template author to pull just the year, month, or day separately — useful for custom report
  footers, filenames typed into the template body, or period-style headers that don't match
  `generated_at`'s fixed format. Add three new placeholders derived from the same
  `datetime.today()` call already used for `generated_at`, so all date-derived values in one
  render stay consistent with each other.

  **Type:** Feature

  **Files:** `src/reports/builder.py` (`_render()`, add `year`/`month`/`day` to `context` near
  line 336, reusing the same `datetime.today()` instance already computing `generated_at` rather
  than calling it again) · `docs/reference/templates.md` (add three new rows immediately after
  `{{ generated_at }}` at line 10, in the same bare-placeholder block — not the annotated
  `{{ split_value }}`/`{{ data_quality }}` block further down) · `tests/test_builder.py` (new
  tests)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - `{{ year }}` renders as a 4-digit year (e.g. "2026")
  - `{{ month }}` renders as a zero-padded 2-digit month (e.g. "07")
  - `{{ day }}` renders as a zero-padded 2-digit day (e.g. "04")
  - All three, plus the existing `{{ generated_at }}`, are derived from the same single
    `datetime.today()` call within one render — no risk of the date rolling over between them
  - `docs/reference/templates.md` documents all three new placeholders in the existing bare
    (undecorated) placeholder block, alongside `{{ generated_at }}`
  - No change to `{{ generated_at }}`'s existing format or any other existing placeholder

  **Unit tests:** `tests/test_builder.py` (new) — (1)
  `test_year_month_day_placeholders_present`: patch the module-level `datetime` import in
  `src.reports.builder` (via `unittest.mock.patch`, the mocking idiom already used elsewhere in
  this file — no new dependency such as freezegun) so `datetime.today()` returns a fixed date,
  build a report, and assert the rendered docx contains the correctly formatted year/month/day
  for that date. (2) `test_date_placeholders_consistent_with_generated_at`: with the same patched
  `datetime.today()`, assert `year`/`month`/`day` and `generated_at` are all consistent with the
  single frozen instant (not independently re-evaluated).

  **E2E:** N/A (no app UI surface — new docxtpl placeholders consumed in an externally-authored
  Word template, exercised via `build-report`; verified by the pytest cases above and the Verify
  command).

  **UAT:** N/A (backend/template-rendering feature, no UI surface; PR review + the pytest cases
  above are the human gate).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_builder.py -k "year_month_day or date_placeholders"`

---

- [x] **MNT-17 — Fix: `{{ split_value }}` documented (and relied on by Express Fill) but missing from the render context (P0)**

  **Created:** 2026-07-04 · **Completed:** 2026-07-04

  `docs/reference/templates.md:20` documents `{{ split_value }}` as available "when --split-by
  is set, the current group's value", and `frontend/src/pages/Composition.jsx:1648` advertises
  it to users as an available token. The archived `XTF-28` card goes further: Express Template
  Fill actively **writes** the literal `{{ split_value }}` placeholder into resolved templates,
  assuming `build-report` fills it in. But `src/reports/builder.py`'s `_render()` never adds
  `split_value` to the docxtpl `context` dict (lines 332-348) — it's only forwarded into
  `generate_narrative()` (line 318) for the AI narrative text, never exposed as its own template
  placeholder. Any template built on this documented/advertised promise silently breaks: a
  Jinja2 undefined value (or error) instead of the actual split value. P0 because this already
  affects a shipped feature (Express Fill's split_value token), not a hypothetical gap.

  **Type:** Fix

  **Files:** `src/reports/builder.py` (`_render()`, add `"split_value": split_value or ""`
  right after `generated_at` at line 336, inside the context dict spanning lines 332-348) ·
  `tests/test_builder.py` (new tests)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - When `report.split_by` is set and a Word template contains `{{ split_value }}`, the rendered
    .docx contains the actual group value (e.g. "Nairobi"), matching what's already used
    internally for the AI narrative
  - When `report.split_by` is NOT set (no split), a template containing `{{ split_value }}`
    renders without error (empty string, not a Jinja2 `UndefinedError` or a literal
    `{{ split_value }}` left in the output)
  - `docs/reference/templates.md`'s existing claim about `{{ split_value }}` (line 20) becomes
    accurate — no doc change needed, the code now matches it
  - Express Fill templates that already embed `{{ split_value }}` (per `XTF-28`) now render
    correctly with no template changes required
  - No regression to the AI narrative's existing use of `split_value`

  **Unit tests:** `tests/test_builder.py` (new) — (1)
  `test_split_value_in_render_context_when_split_by_set`: build a report with `split_by` set to
  a column with 2+ unique values, and assert the rendered docx for each split output contains
  the correct `split_value` for that group. (2) `test_split_value_empty_when_no_split_by`: build
  a report with no `split_by`, assert a template containing `{{ split_value }}` renders without
  raising and produces an empty string, not an undefined-variable error.

  **E2E:** N/A (no app UI surface — `split_value` is a docxtpl/Jinja2 template placeholder
  consumed inside an externally-authored Word template, exercised via `build-report`; verified
  by the pytest cases above and the Verify command).

  **UAT:** N/A (backend/template-rendering fix, no UI surface; PR review + the pytest cases
  above are the human gate).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_builder.py -k split_value`

---

