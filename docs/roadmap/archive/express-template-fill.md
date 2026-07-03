# Express Template Fill — archived (delivered) cards

> Full history also in git. Live roadmap keeps only the ledger row.

- [x] **XTF-28 — Express Fill: infer split_value placeholder from template context (P1)**

  **Created:** 2026-06-30 · **Completed:** 2026-07-01

  When `infer-template` runs on a form configured with `split_by`, short-label placeholders
  that clearly refer to the unit of analysis (e.g. `[[NOM]]`, `[[Nom du site]]`,
  `[[Commune]]`) are not recognized as the `split_value` system placeholder — they are
  inferred as low-confidence indicators or left as `needs_attention`. The resolved template
  ends up with literal "NOM" in report titles instead of the commune name.

  Fix: in `infer_specs`, add `split_value` as a recognized kind. When the config has a
  `split_by` dimension, include it in the LLM prompt so the model can propose
  `kind: split_value` for placeholder tokens that semantically map to the split dimension.
  `annotate_proposals` validates these by checking that the config `split_by` field is set;
  `apply-template` writes `{{ split_value }}` for accepted proposals.

  **Type:** Fix
  **Priority:** P1

  **Files:** `src/reports/template_inference.py` · `src/data/make.py` ·
  `tests/test_template_inference.py`

  **Config/schema impact:** None — `{{ split_value }}` is an existing builder placeholder;
  this fix just wires inference → apply-template to produce it automatically.

  **Acceptance criteria**
  - When `infer-template --template <docx>` is run on a form with `split_by: Commune`
    configured, a placeholder token matching the split label (e.g. `[[NOM]]`) is proposed
    with `kind: split_value` and `status: ok`
  - `apply-template` writes `{{ split_value }}` for any accepted `split_value` proposal
  - The built report title contains the commune name (e.g. "Bougadoum"), not the literal
    placeholder text

  **Unit tests:** `tests/test_template_inference.py`:
  - `test_infer_specs_proposes_split_value_for_nom_token`: with `split_by: Commune` in
    config and a `[[NOM]]` placeholder token, `infer_specs` returns at least one proposal
    with `kind == "split_value"`
  - `test_annotate_split_value_ok_when_split_by_set`: proposal with `kind: split_value`
    gets `status: ok` when config has `split_by` set, `needs_attention` when it is not set
  - `test_apply_template_writes_split_value_placeholder`: an accepted `split_value` proposal
    causes `apply-template` to write `{{ split_value }}` into the resolved `.docx`

  **E2E:** N/A (pure inference-engine fix; no new UI)

  **UAT:** N/A (non-UI/CLI fix; verified via unit tests + `infer-template` CLI run +
  PR review)

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_template_inference.py -q -k "split_value"` ·
  `PYTHONPATH=. MPLBACKEND=Agg python -m pytest -q`

---

- [x] **XTF-27 — Express Fill: bullet_list render type for column-value lists in reports (P1)**

  **Created:** 2026-06-30 · **Completed:** 2026-07-01

  When a template placeholder expects a list of values (e.g. "Nom de tous les villages"),
  there is no way to render it as bullet points — the existing `table` type renders a Word
  table image, and there is no text-based list type. A `bullet_list` chart type should render
  column values as a `•`-prefixed text paragraph injected directly into the docx (not as an
  image), using docxtpl's `{{ list_<name> }}` text placeholder instead of `{{ chart_N }}`
  InlineImage.

  **Type:** Feature
  **Priority:** P1

  **Files:** `src/reports/charts.py` · `src/reports/builder.py` ·
  `src/reports/template_generator.py` · `frontend/src/pages/Composition.jsx` ·
  `tests/test_builder.py` · `frontend/tests/e2e/composition-bullet-list.spec.ts`

  **Config/schema impact:** New `type: bullet_list` value for chart configs. Template
  placeholder changes from `{{ chart_N }}` (image) to `{{ list_<name> }}` (text run).
  `generate-template` must emit a text-run placeholder instead of an image placeholder for
  this type.

  **Acceptance criteria**
  - When a chart config has `type: bullet_list` and `questions: [ColumnName]`, `build-report`
    injects a text paragraph of the form `• value1\n• value2\n…` into the Word document at
    the `{{ list_<name> }}` placeholder position, filtered to the current split slice
  - The `generate-template` command creates a `{{ list_<name> }}` text-run placeholder (not
    `{{ chart_N }}`) in the generated `.docx` when a `bullet_list` chart is configured
  - `bullet_list` appears as a selectable type in the Composition tab's chart type dropdown
  - Both main-table and repeat-table `source:` columns are supported

  **Unit tests:** `tests/test_builder.py`:
  - `test_bullet_list_renders_as_text_not_image`: given a DataFrame with a Village column and
    a bullet_list chart config, the builder context contains `list_<name>` as a string (not an
    InlineImage) with `•`-prefixed entries
  - `test_bullet_list_filters_by_split_value`: when `split_by=Commune` and split_value=X,
    only values from rows where Commune==X appear in the list
  - `test_template_generator_emits_text_placeholder_for_bullet_list`: calling
    `generate_template` with a bullet_list chart produces a `.docx` containing
    `{{ list_<name> }}` as plain text, not an image frame
  - `test_bullet_list_repeat_table_source`: given a repeat-table column as `source:`, the
    builder context contains `list_<name>` with values drawn from the repeat table rows

  **E2E:** `frontend/tests/e2e/composition-bullet-list.spec.ts` — verify `bullet_list`
  option is present in the chart type dropdown on the Composition tab;
  `toHaveScreenshot` baselines at mobile 390×844, tablet 820×1180, desktop 1440×900;
  `npx impeccable audit` + `npx impeccable critique` on the Composition tab clean before merge

  **UAT:**
  1. Open Composition tab → Add a chart → open the chart type dropdown → confirm `bullet_list`
     appears in the list. Expected: option is visible and selectable.
  2. Configure a `bullet_list` chart on the Village column, run
     `python3 src/data/make.py build-report --sample 5` on a downloaded dataset, open the
     output `.docx`. Expected: a `•`-prefixed text list appears at the placeholder position,
     not an image.

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_builder.py -q -k "bullet_list"` ·
  `PYTHONPATH=. MPLBACKEND=Agg python -m pytest -q`

---

- [x] **XTF-26 — Express Fill: auto-resolve proposals when column lives in a repeat table (P1)**

  **Created:** 2026-06-30 · **Completed:** 2026-06-30

  `annotate_proposals` in `src/reports/template_inference.py` validates each inferred proposal
  by looking up the target column in the main flat table only. When the column exists in a repeat
  group table (e.g. `Nombre de ménages` → demographics repeat, `Organisation` → collaborations
  repeat, `Groupe socio-économique` → team repeat), the validator rejects it with "column X not
  found in 'main'" and sets `status: needs_attention` with no `source:` suggestion. The user has
  no actionable path — the placeholder remains blank in the resolved template.

  Fix: when column lookup fails in `main`, search all loaded repeat tables. If the column is found
  in exactly one repeat table, auto-set `source` to that table name and flip `status` to `ok`. If
  found in multiple repeat tables, set `source` to the best-matching table (most rows) and
  `status` to `review` with a note listing the alternatives.

  **Type:** Fix
  **Priority:** P1

  **Files:** `src/reports/template_inference.py` · `tests/test_template_inference.py`

  **Config/schema impact:** None — `apply-template` already handles the `source:` field on
  proposals; this fix just populates it where it was previously left empty.

  **Acceptance criteria**
  - When a placeholder's target column is absent from `main` but present in exactly one repeat
    table, `annotate_proposals` sets `source` to that repeat table name and `status` to `ok`
  - When the column is present in multiple repeat tables, `annotate_proposals` sets `source` to
    the repeat table with the most rows and `status` to `review`, with a note listing the
    alternative table names
  - When the column is not found in `main` or any repeat table, `status` remains `needs_attention`

  **Unit tests:** `tests/test_template_inference.py`:
  - `test_annotate_sets_source_from_single_repeat_table`: catalog has column absent from main but
    present in one repeat table; assert proposal gets `source` set to that table name and
    `status == 'ok'`
  - `test_annotate_sets_source_review_for_ambiguous_repeat`: column present in two repeat tables;
    assert `status == 'review'`, `source` is the table with more rows, and the note mentions both
    table names
  - `test_annotate_keeps_needs_attention_when_column_nowhere`: column absent from main and all
    repeat tables; assert `status == 'needs_attention'`
  - `test_annotate_resolves_known_repeat_columns_from_fixture_profile`: fixture profile contains
    demographic columns (`nombre_menages`, `nombre_habitants`) in one repeat table and a
    socioeconomic column (`groupe_socioeconomique`) in a second repeat table; assert each proposal
    gets the correct `source` and `status == 'ok'`

  **E2E:** N/A (pure inference-engine fix; the Templates tab proposal review panel renders
  whatever the API returns — no new UI component or interaction)

  **UAT:** N/A (non-UI/CLI fix; verified via unit tests + `infer-template` CLI run + PR review)

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_template_inference.py -q -k "repeat"` ·
  `PYTHONPATH=. MPLBACKEND=Agg python -m pytest -q`
  Optional smoke (requires a form with repeat groups already downloaded): run
  `python3 src/data/make.py infer-template` and confirm repeat-group columns resolve to
  `status: ok` with `source:` set to the correct repeat table name.

---

- [x] **XTF-25 — Express Template Fill: extractor must read Word content controls (w:sdt) (P2)**

  **Created:** 2026-06-27 · **Completed:** 2026-06-27

  `_tokens_in_paragraph` in `src/reports/template_inference.py` iterates only
  `paragraph.runs` (top-level `w:r` elements). Text inside gray-shaded Word **content
  controls** (`w:sdt → w:sdtContent → w:r → w:t`) is invisible to the extractor, so any
  `[[placeholder]]` typed inside a content control is silently skipped and the Express UI
  shows "Aucun espace réservé à examiner." Fix by walking `paragraph._p.iter()` for all
  descendant `w:t` elements, which covers both plain-paragraph runs and content-control runs
  in a single pass. Non-UI, non-CLI — Python extractor only.

  **Files:** `src/reports/template_inference.py` (`_tokens_in_paragraph` function) ·
  `tests/test_template_inference.py` (new or extend)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - A `.docx` whose paragraph text is wrapped in a content control (`w:sdt`) and contains
    `[[PLACEHOLDER]]` is correctly detected by `_tokens_in_paragraph` — the placeholder
    appears in the returned token list
  - A plain-paragraph `[[PLACEHOLDER]]` (no content control) continues to be detected as
    before (no regression)
  - A paragraph with both a plain run and a content-control run returns tokens from both
  - `extract_placeholders` (the caller) therefore lists placeholders from content-control
    paragraphs; the Express UI no longer shows "Aucun espace réservé à examiner" for a
    template that only uses content-control placeholders

  **Unit tests:** `tests/test_template_inference.py` — (1) build a minimal `python-docx`
  document that wraps `[[TOKEN_IN_SDT]]` inside a `w:sdt` content control and assert
  `_tokens_in_paragraph` returns `["TOKEN_IN_SDT"]`; (2) assert a plain-run `[[TOKEN_PLAIN]]`
  paragraph still returns `["TOKEN_PLAIN"]`; (3) assert a paragraph containing both a plain
  run and an `sdt` run returns both tokens; (4) assert that the regression path
  (`extract_placeholders` on such a doc) returns a non-empty list.

  **E2E:** N/A (Python-only extractor; no UI surface — verified via unit tests + the verifier
  + PR review).

  **UAT:** N/A (non-UI/CLI card — the human gate is PR review + unit tests green).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_template_inference.py`

---

- [x] **XTF-24 — Restrict split-by dropdown to select_one columns**

  **Created:** 2026-06-19 · **Completed:** 2026-06-19

  The "Split by" combobox in `BuildOptions` (`frontend/src/components/BuildOptions.jsx`, the
  `splitCols` useMemo ~46–52) currently lists EVERY main-table column (any question with no
  `repeat_group` + an `export_label`), regardless of type — so notes, usernames, numbers, dates,
  multi-selects etc. all appear, and splitting on them produces garbage (one report per number / per
  free-text note). Restrict the option set further to **single-select columns only**: questions whose
  kobo `type` starts with `select_one` (covers `select_one` and `select_one_from_file`; EXCLUDES
  `select_multiple*`, `integer`/`decimal`/`range`, `text`/`note`, `gps`/`geo*`, `date*`, and
  undefined). The `type` field is present on every question reaching BuildOptions (both the Express
  review panel via `frontend/src/pages/Templates.jsx` and the normal Reports build via
  `frontend/src/pages/Reports.jsx` source `questions` from `/api/config`, which preserves `type`), so
  the single change to `splitCols` covers BOTH surfaces. **Frontend only** — the backend
  `build-report --split-by` keeps accepting any column (it already warns + falls back to a single
  report for an unusable split column); the dropdown is the guardrail. The "No split — one combined
  report" option stays first. Depends on **XTF-13** (BuildOptions) + **XTF-17** (searchable combo) +
  **XTF-1–XTF-23** (shipped). Independent of the other XTF cards.

  **Files:** `frontend/src/components/BuildOptions.jsx` (extend the `splitCols` filter ~46–52 to also
  require `q.type` startsWith `select_one`) · `frontend/tests/e2e/build-options.spec.ts` (extend — the
  existing spec already builds a typed `config.yml`; seed a mix of question types and assert the
  restricted option set)

  **Config/schema impact:** None — reads the existing question `type` field already present on each
  question object.

  **Acceptance criteria**
  - The split-by dropdown lists ONLY columns whose question `type` starts with `select_one` (i.e.
    `select_one` and `select_one_from_file`)
  - `select_multiple*`, `integer`/`decimal`/`range`, `text`, `note`, `gps`/`geo*`, and `date*`
    columns are NOT offered as split-by options (even though they are main-table columns)
  - The "No split — one combined report" option remains FIRST in the list and still clears `split_by`
  - The restriction applies identically in the Express review panel (Templates.jsx) and the regular
    Reports build path (Reports.jsx) — both render the same `BuildOptions`
  - The XTF-17 typeahead filter still works over the restricted (select_one-only) option set
  - The downstream build contract is unchanged (a chosen `split_by`/`split_sample` is still forwarded)
  - Impeccable audit/critique clean on the restricted combobox

  **Unit tests:** N/A (frontend-only filter change; Vitest is not installed — the gate is asserted by
  the Playwright E2E below, consistent with XTF-7/XTF-17/XTF-21).

  **E2E:** `frontend/tests/e2e/build-options.spec.ts` (extend) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — seed the mocked `config.yml` with a mix of main-table question types: a
  `select_one` column, a `select_multiple` column, an `integer` column, a `text` column, and a `note`
  column (all without `repeat_group`). Open the split-by combobox and assert ONLY the `select_one`
  column appears as a `build-split-option` (assert each of the `select_multiple`/`integer`/`text`/
  `note` columns is absent), and assert the "No split" option is present and first. Capture a
  `toHaveScreenshot` baseline of the open dropdown showing the restricted list at all three viewports
  (mobile 390×844, tablet 820×1180, desktop 1440×900); a human approves the new baselines.

  **UAT:**
  1. With downloaded data on a form that has a mix of question types, open the Build options (Reports
     → Build, or Express review panel) and click the "Split by" field.
     Expected: the dropdown opens and "No split — one combined report" is the first entry.
  2. Scan the listed options. Expected: only single-select (select_one) columns are listed — number,
     date, free-text/note, username, and multi-select questions are NOT present.
  3. Type part of a select_one column name (XTF-17 typeahead). Expected: the list narrows to matching
     select_one columns; no excluded-type column ever appears regardless of the filter text.
  4. Pick a select_one column and build. Expected: the report splits by that single-select column as
     before.

  **Verify:** `cd frontend && npx playwright test build-options.spec.ts`

---

- [x] **XTF-23 — DELETE /api/reports (all + single) deletes durable storage objects**

  **Created:** 2026-06-19 · **Completed:** 2026-06-19

  Bug from the follow-up batch (issue ② in the spec, durable-delete half). `DELETE /api/reports`
  (`web/main.py` ~1848) and `DELETE /api/reports/{filename}` (~1858) only `unlink` local files, so a
  delete is undone by the next run's `pull_workspace` (the durable storage object survives and is
  re-pulled). Fix: both handlers also delete the corresponding `reports` storage object(s) via
  `delete_project_file` (resolved for the caller's active org/project) so manual cleanup is durable.
  Shares the durable-delete primitive (`delete_project_file`) with XTF-19 but does **not** block on
  it — coordinate so whichever merges second rebases cleanly. Independent of XTF-20/21/22. Depends on
  **XTF-1–XTF-18** (shipped).

  **Files:** `web/main.py` (`delete_all_reports` ~1848 and `delete_report` ~1858 also
  `delete_project_file` the matching `reports` storage object(s), resolving the caller's org/project)
  · `tests/test_reports_api.py`

  **Config/schema impact:** None.

  **Acceptance criteria**
  - `DELETE /api/reports` removes both the local `.docx` files AND the corresponding `reports`
    storage objects (resolved for the caller's active org/project), so a subsequent `pull_workspace`
    restores nothing
  - `DELETE /api/reports/{filename}` removes the matching local file AND only that file's storage
    object (other report objects untouched)

  **Unit tests:** `tests/test_reports_api.py` — (1) `test_delete_all_reports_durable`: `DELETE
  /api/reports` removes both local files and storage objects — assert (via a spy storage backend)
  `delete_project_file` was called for each `reports` object and a follow-up `pull_workspace` restores
  nothing. (2) `test_delete_one_report_durable`: single-file DELETE removes only the matching storage
  object, leaving the others.

  **E2E:** N/A (back-end API, no UI surface — consistent with XTF-8; the Reports tab triggers the
  delete but the change is back-end. Human gate is the unit tests + the verifier + PR review).

  **UAT:** N/A (back-end fix; verified via the Verify command, unit tests, the verifier, and PR
  review — UAT moves in lockstep with E2E).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_reports_api.py`

---

- [x] **XTF-22 — Deterministic auto-modeling resolver for cross-table columns**

  **Created:** 2026-06-19 · **Completed:** 2026-06-19

  Feature from the follow-up batch (issue ④ in the spec). Infer rejects placeholders whose column
  lives in a repeat-group base table because validation defaults `source` to `"main"`
  (`src/reports/ask_engine.py` ~79–116; `src/reports/template_inference.py` ~306–327) — even though
  the inference catalog already includes ALL tables and `builder._pick_df`
  (`src/reports/builder.py` ~34–71) already auto-selects the right table at build time. Add a
  deterministic pass `resolve_sources(proposals, profile)` (plain Python, no extra LLM tokens) that
  runs AFTER `infer_specs` and BEFORE `annotate_proposals`. For each data proposal, collect the
  referenced columns (`questions` + `group_by`) and map each to the profile table(s) containing it:
  all-in-`main` → leave as-is; all-in-one-non-main-table → stamp `source: <table>` (use the
  `_pick_df` most-columns-match heuristic when a column appears in several tables); spans a repeat
  table + `main` (join case) → synthesize a persisted view
  `{name, source:<repeat_table>, join_parent:[<main cols>]}` carrying `group_by`/`question`/`agg`
  only when the chart is inherently aggregated, and point the spec's `source` at the new view;
  stuck (column in no table, or genuine tie) → keep `needs_attention` with a reason naming the
  candidate tables. Synthesized views are persisted into `config.yml` `views:` on **apply**
  (`/api/template/apply`), NOT on infer; view names are deterministic + collision-safe (e.g.
  `auto_<repeat_leaf>__<joincols>`, de-duped against existing `views:`) so re-running Infer is
  idempotent. Validation already validates against the resolved `source` once stamped. Back-end
  (the express UI flow is already covered by XTF-5/6). Depends on **XTF-1–XTF-18** (shipped).
  Independent of XTF-19/20/21.

  **Files:** `src/reports/template_inference.py` (new `resolve_sources`, or a small new module it
  imports) · `web/main.py` (`/api/template/infer` runs `resolve_sources` between `infer_specs` and
  `annotate_proposals`; `/api/template/apply` persists any synthesized views into config `views:`) ·
  `tests/test_template_inference.py` (resolver unit cases) · `tests/test_template_api.py` (the
  apply-persists-view API case)

  **Config/schema impact:** None to the schema. Synthesized entries use the existing `views:` shape
  (`name`, `source`, `join_parent`, optional `group_by`/`question`/`agg`); on apply they are appended
  to `config["views"]` de-duped by name.

  **Acceptance criteria**
  - `resolve_sources(proposals, profile)` runs after `infer_specs` and before `annotate_proposals`
    and resolves each data proposal's `source` deterministically (no LLM call)
  - A proposal whose referenced columns all live in a single repeat-group table gets `source`
    stamped to that table and validates clean (no `needs_attention`)
  - A proposal referencing a repeat-group column + a `main` column yields a synthesized view
    `{source:<repeat_table>, join_parent:[<main col>]}` and the spec's `source` points at the view
  - Synthesized view names are deterministic and collision-safe (de-duped against existing `views:`),
    so re-running the resolver on the same proposals is idempotent (no duplicate view names)
  - A column present in NO table stays `needs_attention` with a reason that no table contains it; a
    genuine multi-table tie stays `needs_attention` with a reason naming both candidate tables
  - `/api/template/apply` persists any synthesized views into the config `views:` section (appended,
    de-duped); `/api/template/infer` returns proposals carrying the resolved `source` (+ any pending
    synthesized-view definitions)

  **Unit tests:** `tests/test_template_inference.py` — (1) `test_resolve_single_repeat_column`: a
  chart referencing one repeat-group column gets `source` stamped to that table and `annotate_proposals`
  returns `status: ok` (no `needs_attention`). (2) `test_resolve_join_synthesizes_view`: a chart
  referencing a repeat column + a main column yields a synthesized view with `source` = repeat table
  and `join_parent` = `[main col]`, and the spec sources the view. (3) `test_resolve_idempotent`:
  running the resolver twice produces no duplicate synthesized-view names. (4)
  `test_resolve_unknown_column_flagged`: a column in no table stays `needs_attention` with a reason
  saying no table contains it. (5) `test_resolve_tie_flagged`: a genuine multi-table tie stays
  `needs_attention` with both candidate tables named. Plus `tests/test_template_api.py` —
  `test_apply_persists_synthesized_view`: `/api/template/apply` with a proposal carrying a synthesized
  view writes that view into `config["views"]` (appended, de-duped).

  **E2E:** N/A (back-end inference logic — no UI surface of its own; the express UI flow is covered by
  XTF-5/XTF-6. Human gate is the unit/API tests + the verifier + PR review).

  **UAT:** N/A (back-end fix; verified via the Verify command, unit tests, the verifier, and PR
  review — UAT moves in lockstep with E2E).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_template_inference.py tests/test_template_api.py`

---

- [x] **XTF-21 — Express split-by dropdown no longer clipped (CSS stacking)**

  **Created:** 2026-06-19 · **Completed:** 2026-06-19

  Bug from the follow-up batch (issue ③ in the spec). In the Express review panel (shown after
  Infer), the "Split by" combobox menu is clipped/hidden behind sibling content when opened:
  `.express-review-panel { overflow: hidden }` (`frontend/src/styles.css` ~925) clips the
  absolutely-positioned `.build-combo__list` (`position:absolute; z-index:30`,
  `frontend/src/styles.css` ~1014–1020). Fix: let the menu escape its container — preferred remove
  `overflow: hidden` from `.express-review-panel` (it's there for border-radius cosmetics; verify
  nothing depends on it) and ensure the combo list stacks above sibling rows; fallback if rounded
  corners regress, keep overflow but raise `.build-combo` into its own stacking context / render the
  menu so it is not clipped. UI-facing. Depends on **XTF-17** (the searchable combo) +
  **XTF-1–XTF-18** (shipped). Independent of XTF-19/20/22.

  **Files:** `frontend/src/styles.css` (`.express-review-panel`, `.build-combo` /
  `.build-combo__list`) · possibly `frontend/src/components/BuildOptions.jsx` (only if a structural
  tweak is needed to lift the menu out of the clipping context) ·
  `frontend/tests/e2e/express-template-fill.spec.ts` (extend with the open-dropdown assertion +
  baselines)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - After Infer, opening the Express "Split by" combobox shows the full options listbox, not clipped
    by the review panel (the listbox extends beyond the panel's rounded-corner bounds when needed)
  - The open listbox stacks above the sibling rows/content of the review panel (correct z-order)
  - The `.express-review-panel` retains its rounded corners (border-radius unchanged) and clips no
    other content — verified by the desktop `toHaveScreenshot` baseline of the closed-panel state
  - Keyboard/typeahead behavior of the combobox (from XTF-17) is unchanged
  - Impeccable audit/critique clean on the open-dropdown state in the Express panel

  **Unit tests:** N/A (frontend-only CSS/stacking change; Vitest is not installed — the fix is
  asserted by the Playwright E2E below, consistent with XTF-5/XTF-7/XTF-17).

  **E2E:** `frontend/tests/e2e/express-template-fill.spec.ts` (extend) + visual (impeccable
  audit/critique + `toHaveScreenshot`) — drive the Express flow to the review panel (after Infer),
  open the "Split by" combobox, and assert the listbox is visible and **not clipped** by the panel
  (e.g. its bounding box extends past the panel's clip bound / it is fully visible above sibling
  rows). Capture a `toHaveScreenshot` baseline of the OPEN-dropdown state AND the closed-panel state
  (to prove rounded corners are retained) at all three viewports (mobile 390×844, tablet 820×1180,
  desktop 1440×900); a human approves the new baselines.

  **UAT:**
  1. Templates tab → "In a hurry?" Express fill. Upload a `.docx` with placeholders and click Infer.
     Expected: the review panel appears with per-placeholder rows.
  2. At desktop width (~1440px) click the "Split by" field. Expected: the dropdown opens and every
     option row is fully readable, with the bottom-most option rendered below the panel's lower edge
     (not sliced by the panel border).
  3. Type into the field to filter (XTF-17 typeahead). Expected: the list narrows and stays fully
     visible above the rows beneath it.
  4. Narrow the window to ~390px (mobile) and repeat step 2. Expected: the open list is still fully
     visible and not clipped; panel corners remain rounded.
  5. Close the dropdown. Expected: the panel returns to its rounded-corner state with no visual
     artifact.

  **Verify:** `cd frontend && npx playwright test express-template-fill.spec.ts`

---

- [x] **XTF-20 — Reports listing shows storage build-time (with local-mtime fallback)**

  **Created:** 2026-06-19 · **Completed:** 2026-06-19

  Bug from the follow-up batch (issue ② in the spec, read/listing half). `GET /api/reports`
  (`web/main.py` ~1826–1835) reports each file's **local mtime**, but `pull_workspace`'s S3
  `download_file` resets local mtime to pull-time — so every pulled report shows "today" regardless
  of when it was built. Fix: the listing surfaces each file's **storage object last-modified**
  (push/build time), falling back to local mtime in pure-local mode when there is no storage object
  (the filename's `_YYYYMMDD` is already correct and unchanged). Needs a storage last-modified
  accessor: the `Storage` base currently has no `last_modified`/stat method — add one to the
  abstraction and the local + S3 backends. Durable deletes are the separate XTF-23 deliverable; this
  card is read/listing only. Shares no blocking dependency with XTF-23. Independent of XTF-21/22.
  Depends on **XTF-1–XTF-18** (shipped).

  **Files:** `web/main.py` (`list_reports` ~1826 surfaces storage last-modified with a local-mtime
  fallback) · `web/storage/base.py` (add a `last_modified(key)` / stat accessor to the `Storage`
  abstraction) · `web/storage/*` backends (implement `last_modified` on the local + S3 backends) ·
  `tests/test_reports_api.py` (existing reports-API test file; extend it)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - `GET /api/reports` returns, for each report, a `modified` timestamp sourced from the **storage
    object's last-modified** (push/build time), not the reset local mtime
  - When no storage object exists for a file (pure-local mode), the listing falls back to local
    mtime without erroring
  - A `Storage.last_modified(key)` (or equivalent stat) accessor exists on the abstraction and the
    local + S3 backends and returns the object's last-modified time

  **Unit tests:** `tests/test_reports_api.py` — (1) `test_list_reports_uses_storage_modified`: with
  a fake/spy storage backend returning a known last-modified for a report key (distinct from the
  local file's reset mtime), assert the listing's `modified` reflects the STORAGE value, not the
  local mtime. (2) `test_list_reports_local_fallback`: a file with no storage object falls back to
  local mtime without error. (3) `test_storage_last_modified_implemented`: assert
  `Storage.last_modified(key)` is implemented on BOTH the local and S3 backends and returns the
  object's last-modified time.

  **E2E:** N/A (back-end API behavior, no UI surface of its own — consistent with XTF-8; the Reports
  tab consumes the value but the change is back-end. Human gate is the unit tests + the verifier + PR
  review).

  **UAT:** N/A (back-end fix; verified via the Verify command, unit tests, the verifier, and PR
  review — UAT moves in lockstep with E2E).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_reports_api.py`

---

- [x] **XTF-19 — Storage push mirrors output categories (fixes split-preview leaving stale reports)**

  **Created:** 2026-06-19 · **Completed:** 2026-06-19

  Bug from the follow-up batch (issue ① in the spec). `push_outputs`
  (`web/storage/workspace.py` ~64–72) is **merge-only**: a split preview that builds 2 reports into
  the run tempdir uploads those 2 but never deletes the ~24 prior report objects already in durable
  storage. `_persist_run_outputs` (`web/main.py` ~1683–1697) then `pull_workspace`s **everything**
  back into the local mirror, so the old reports reappear — durable storage acts as an un-pruned
  cache. `build-report`'s run inputs are `["processed","templates"]` (NOT `reports`), so the tempdir
  already holds exactly this run's outputs. Fix: add a per-command **output** category map and make
  the push **mirror-delete** (delete storage objects under a category's prefix that are absent from
  the tempdir set) **only for the command's declared output categories**; every other category stays
  merge-only. This MUST avoid the footgun where `download` (which hydrates neither `reports` nor
  `templates`) wipes them. Independent of XTF-20/21/22. Depends on **XTF-1–XTF-18** (shipped).

  **Files:** `web/storage/workspace.py` (new `RUN_OUTPUTS` map e.g.
  `{"build-report":["reports"], "run-all":["reports"], "generate-template":["templates"],
  "ai-generate-template":["templates"], "download":["processed"]}`; teach `push_outputs` to
  mirror-delete the declared output categories using `store.list(prefix)` + single-key
  `delete_project_file`/`store.delete`, leaving undeclared categories merge-only) · `web/main.py`
  (`_persist_run_outputs` accepts/forwards the run `command` so the push knows which categories to
  mirror; thread the command through from the run path that calls it) · `tests/test_workspace.py`

  **Config/schema impact:** None. Reports/templates/processed are regenerable run outputs; a run
  replaces its own declared categories.

  **Acceptance criteria**
  - A per-command `RUN_OUTPUTS` map declares the output categories each command produces
    (`build-report`/`run-all` → `reports`; `generate-template`/`ai-generate-template` → `templates`;
    `download` → `processed`); commands with no declared outputs prune nothing
  - For a command's declared output categories, the push deletes durable-storage objects under that
    category prefix that are NOT present in the local/tempdir set (mirror-delete), then uploads the
    current set
  - All categories NOT declared as outputs for that command stay **merge-only** (no deletes) — in
    particular `download` never touches `reports`/`templates` storage objects
  - After the push + a subsequent `pull_workspace`, the local mirror for a mirrored category equals
    exactly the tempdir's set (no resurrected stale files)
  - Only `store.list(prefix)` + single-key delete are used (no new S3 calls / no `delete_prefix`
    blanket wipe)

  **Unit tests:** `tests/test_workspace.py` (using the local/fake storage backend the existing
  workspace tests use) — (1) `test_push_mirrors_build_report_reports`: seed durable storage with 26
  stale `reports` objects, build a tempdir holding exactly 2 report `.docx`, run the push for command
  `build-report`, and assert durable storage AND a subsequent `pull_workspace` mirror end with
  exactly those 2. (2) `test_download_push_leaves_reports_and_templates`: with existing `reports`
  and `templates` objects in storage, run the push for command `download` (declares only
  `processed`) and assert the `reports`/`templates` objects are untouched (regression guard against
  the wipe footgun). (3) `test_generate_template_push_mirrors_only_templates`: a `generate-template`
  push mirrors `templates` to the tempdir set and leaves existing `reports` objects untouched.

  **E2E:** N/A (back-end storage behavior — no UI surface of its own; the Reports list just reflects
  durable storage. Human gate is the unit tests + the verifier + PR review).

  **UAT:** N/A (back-end fix; verified via the Verify command, unit tests, the verifier, and PR
  review — UAT moves in lockstep with E2E).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_workspace.py`

---

- [x] **XTF-18 — Fix: express-path terminal does not auto-collapse after ~5s**

  **Created:** 2026-06-19 · **Completed:** 2026-06-19

  Bug from review: XTF-11's auto-collapse (terminal opens on a build run, collapses after
  `window.__TERM_COLLAPSE_MS ?? 5000`, `App.jsx` `onStatus` ~184-199) works for the regular build
  but NOT when the build is launched from the Express **Apply & build** flow (`Templates.jsx`
  `applyAndBuild` → `await fetch('/api/template/apply')` then `run('build-report', opts)`). The
  terminal opens and stays open past the delay. Root-cause via the test reproduction (likely the
  apply step or the express run path interferes with the collapse timer / user-override flag), then
  fix so the express build collapses on the SAME ~5s timing as the regular build (and still
  auto-expands on error). Depends on XTF-11 (collapse logic). Independent of XTF-16/17.

  **Files:** `frontend/src/App.jsx` (onStatus/collapse timing) and/or `frontend/src/pages/Templates.jsx`
  (`applyAndBuild` — ensure it doesn't suppress/skip the auto-collapse) · `frontend/tests/e2e/terminal-collapse.spec.ts`
  (add an express-flow case)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - Launching a build via the Express **Apply & build** flow opens the terminal and auto-collapses
    it to the bar after the configured delay (default ~5s), while the run keeps streaming — same as
    the regular build
  - On an express build that ends in error, the terminal still auto-expands
  - Manual toggling during an express build still works (a user-opened terminal is not auto-collapsed)
  - The regular-build collapse behavior (XTF-11) is unchanged

  **Unit tests:** N/A (frontend-only timing; Vitest not installed — asserted by the Playwright E2E
  below with the overridable test delay).

  **E2E:** `frontend/tests/e2e/terminal-collapse.spec.ts` (extend) + visual (impeccable
  audit/critique + `toHaveScreenshot`) — with `window.__TERM_COLLAPSE_MS` set small, drive the
  EXPRESS Apply&build flow (mock `/api/template/apply` → ok, then the build SSE `running`), assert
  the terminal opens then collapses to the bar after the delay while still running, and auto-expands
  on an error frame. Refresh any affected baseline at all three viewports (mobile 390×844, tablet
  820×1180, desktop 1440×900).

  **UAT:**
  1. From the Express flow, Apply & build a report. Confirm the terminal opens, then ~5s later
     collapses to the bottom bar while the build continues.
  2. Trigger an express build that fails and confirm the terminal auto-expands to show the error.
  3. Manually open the terminal during an express build and confirm it stays open (not auto-collapsed).

  **Verify:** `cd frontend && npx playwright test terminal-collapse.spec.ts`

---

- [x] **XTF-17 — Searchable split-by dropdown in the build options**

  **Created:** 2026-06-19 · **Completed:** 2026-06-19

  The split-by control (`frontend/src/components/BuildOptions.jsx`) is a plain `<select>`. For
  forms with many main-table columns it's hard to scan. Make it a **searchable/filterable**
  dropdown (type to filter the options) while keeping the same value contract (selecting a column
  sets `split_by`; clearing → no split). Applies wherever BuildOptions renders (express + regular).
  Depends on XTF-13 (BuildOptions). Independent of XTF-16/18.

  **Files:** `frontend/src/components/BuildOptions.jsx` (searchable combobox for split-by;
  keep `data-testid="build-split-by"` resolving to the control + preserve the main-table-only
  option set) · `frontend/src/styles.css` (combobox styles) ·
  `frontend/tests/e2e/build-options.spec.ts` (typeahead filter assertions)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - The split-by control lets the user type to filter the column options (combobox), not just a
    bare native select
  - The option set is still MAIN-table `export_label`s only (repeat-group excluded), unchanged
    from XTF-13; selecting one sets `split_by`; a clear/"No split" choice removes it
  - Keyboard accessible (focus, type-to-filter, arrow/enter select, escape close) with an
    accessible label; `data-testid="build-split-by"` still resolves to the control
  - The downstream build contract is unchanged (chosen split_by/split_sample still forwarded)
  - Impeccable audit/critique clean on the combobox

  **Unit tests:** N/A (frontend-only control; Vitest not installed — asserted by the Playwright
  E2E below, consistent with prior UI cards).

  **E2E:** `frontend/tests/e2e/build-options.spec.ts` (extend) + visual (impeccable audit/critique
  + `toHaveScreenshot`) — with a mocked questions catalog containing several main-table columns +
  one repeat-group column, open the split-by combobox, type a filter substring and assert the list
  narrows to matching main-table columns (and the repeat-group column never appears); pick one and
  assert `split_by` is set on the build request; assert the "No split" option clears it. Capture a
  `toHaveScreenshot` baseline of the open combobox at all three viewports (mobile 390×844, tablet
  820×1180, desktop 1440×900).

  **UAT:**
  1. Open the Build options (express or Reports) on a form with many columns. Click the split-by
     control and type part of a column name — confirm the list filters to matches.
  2. Confirm only main-table columns appear (no repeat-group fields), pick one, and build — confirm
     the report splits by it.
  3. Choose "No split" and confirm a single combined report builds.

  **Verify:** `cd frontend && npx playwright test build-options.spec.ts`

---

- [x] **XTF-16 — build-report clears the reports output dir so each build is the current set**

  **Created:** 2026-06-19 · **Completed:** 2026-06-19

  Bug from review: `build-report` only `mkdir`s the reports `output_dir` (`src/reports/builder.py`
  ~233) and never removes prior outputs, so reports ACCUMULATE across runs. Two symptoms: (a) a
  "first N groups" (`--split-sample`) preview correctly builds only N new files but the dir still
  holds every report from earlier full builds, so the list / Download-all-ZIP shows "everything";
  (b) those leftover files carry an older `_YYYYMMDD` filename suffix (the build date they were
  made, `builder.py` ~236 uses `datetime.today()`) while their pull-to-mirror mtime reads as today
  — so an old report looks freshly generated. Fix: at the start of a build run, clear the prior
  `*.docx` report outputs in `output_dir` so the resulting set reflects ONLY the current build
  (works for default, split-by, and `--split-sample`). Per-run web isolation already pushes the
  fresh set to storage. Backend. Independent of XTF-17/18. Depends on XTF-13 (split options).

  **Files:** `src/reports/builder.py` (clear `output_dir` `*.docx` before the split loop / first
  `_render`) · `tests/test_build_report_smoke.py` (or a new `tests/test_build_report_outputs.py`)

  **Config/schema impact:** None. Reports are regenerable outputs; a build replaces them.

  **Acceptance criteria**
  - At the start of a build, existing `*.docx` in the reports `output_dir` are removed before the
    new report(s) are written (the build's result is exactly the current run's outputs)
  - A split build with `--split-sample 2` over a column with >2 values yields EXACTLY 2 report
    files in `output_dir` (no leftovers from a prior full build)
  - A full split build after a "first 2" build replaces the 2 with the full set (no stale 2 left)
  - A non-split build yields exactly one report; re-running replaces it (no accumulation)
  - Charts dir (`data/processed/charts`) handling is unchanged; only the reports `output_dir`
    `*.docx` are cleared

  **Unit tests:** `tests/test_build_report_outputs.py` (new) — (1) seed `output_dir` with two
  stale `*.docx`, run `ReportBuilder.build()` (single report), assert the stale files are gone and
  only the new report remains. (2) build with `split_by` over 3 values + `split_sample=2` → assert
  exactly 2 `*.docx` exist. (3) then build with `split_sample=None` (all 3) → assert exactly 3 and
  the prior 2 don't linger as a 4th/5th. Use a tmp `output_dir` + a small fixture df.

  **E2E:** N/A (back-end build behavior — no UI surface of its own; the Reports list/ZIP just
  reflects the dir. Human gate is the unit tests + PR review).

  **UAT:** N/A (back-end fix; verified via the unit tests, the verifier, and PR review — UAT moves
  in lockstep with E2E).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_build_report_outputs.py`

---

- [x] **XTF-15 — Remove the redundant rail "Build report" Quick Action on the Reports page**

  **Created:** 2026-06-19 · **Completed:** 2026-06-19

  Follow-up from XTF-13/14 review. The Reports page now shows TWO "Build report" buttons: the
  Quick Actions rail action (`Reports.jsx` ~127, `run('build-report')` with no options) and the
  XTF-13 BuildOptions control's `build-run` button (split-by + sample). The BuildOptions entry
  supersedes the rail one ("Build all groups (default)" == the rail's no-option build), and two
  identically-labelled buttons on one page is a UX smell (it also caused the ambiguous-locator
  regression repaired in XTF-14). Remove the rail "Build report" Quick Action; keep the other
  rail actions (e.g. Compare periods). Depends on **XTF-13** (BuildOptions) + **XTF-1–14**
  (shipped).

  **Files:** `frontend/src/pages/Reports.jsx` (drop the "Build report" entry from the
  `QuickActionsCard` actions ~127) · `frontend/tests/e2e/build-options.spec.ts` (assert a single
  build control) · `frontend/tests/e2e/reports-delete-all.spec.ts` + `run-alert.spec.ts` +
  `terminal-collapse.spec.ts` (refresh the Reports-page baselines the rail change affects)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - The Reports page has exactly ONE "Build report" control — the BuildOptions `build-run`
    button; the Quick Actions rail no longer contains a "Build report" action
  - The remaining Quick Actions (e.g. Compare periods) are unchanged and still work
  - Building from the BuildOptions control is unaffected (still calls `run('build-report', opts)`)
  - Impeccable audit/critique clean on the updated Reports header/rail (no orphaned spacing)

  **Unit tests:** N/A (frontend-only markup removal; Vitest not installed — asserted by the
  Playwright E2E below, consistent with prior UI cards).

  **E2E:** `frontend/tests/e2e/build-options.spec.ts` (extend) + visual (impeccable audit/critique
  + `toHaveScreenshot`) — on the Reports page, assert `getByRole('button', {name:/build report/i})`
  resolves to EXACTLY ONE element (the `build-run` control) and the Quick Actions rail does not
  contain a "Build report" action. Refresh the affected Reports-page baselines (the
  `reports-delete-all.png` and the run-state baselines that screenshot the Reports rail —
  `run-alert.png`, `terminal-collapse` — change because the rail loses a button) at all three
  viewports (mobile 390×844, tablet 820×1180, desktop 1440×900); a human re-approves them.

  **UAT:**
  1. Open Deliver → Reports. Confirm there is a single "Build a report" entry (the Build options
     panel) and the Quick Actions rail no longer has a separate "Build report" button.
  2. Confirm the other Quick Actions (Compare periods) are still present and work.
  3. Build from the Build options panel and confirm a report is produced as before.

  **Verify:** `cd frontend && npx playwright test build-options.spec.ts`

---

- [x] **XTF-14 — Reposition the run alert in-page (below the title, content width) + icon Stop**

  **Created:** 2026-06-18 · **Completed:** 2026-06-19

  Refinement of XTF-10. The run alert currently renders as a fixed bar pinned above the top
  nav (App.jsx ~265, outside the page). Move it to flow **inside the page content** — below the
  top nav and the page title/header, immediately before the page's main container — constrained
  to the main-container width with top + bottom margin (not a full-bleed fixed bar). Replace the
  text "Stop" button with a compact **icon button** (X / stop icon) carrying an accessible label.
  All other XTF-10 behavior (shown while `running`, reads the active command, View-logs link,
  `stop` via `/api/stop/{run_id}`, clears on terminal status, `role="status"`) is preserved.
  Depends on **XTF-10** (shipped). Independent of XTF-11/12/13.

  **Files:** `frontend/src/App.jsx` (render the alert inside the content column — below the
  nav/page header, before the active pane — instead of the fixed top bar) ·
  `frontend/src/styles.css` (in-flow `.run-alert` layout: content-width, vertical margins; icon
  stop button) · `frontend/tests/e2e/run-alert.spec.ts` (update placement + icon-stop assertions
  and refresh the baseline)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - While `running`, the alert renders **in the page content flow** (below the top nav + page
    title, before the main container), at the content/main-container width with visible top and
    bottom margin — NOT a fixed full-width bar pinned to the viewport top
  - The Stop control is an **icon button** (e.g. X or a stop glyph), not a text button, with an
    accessible label (`aria-label`) and visible focus ring; it still calls `useCommand.stop()`
    (→ `POST /api/stop/{run_id}`, fallback `/api/stop`)
  - All preserved XTF-10 behavior still holds: `data-testid="run-alert"` + `run-stop`; shows the
    active command; View-logs toggles the terminal; alert clears on a terminal status;
    `role="status"`
  - Impeccable audit/critique clean on the repositioned alert + icon button

  **Unit tests:** N/A (frontend-only placement/markup change; Vitest not installed — asserted by
  the Playwright E2E below, consistent with XTF-9/10).

  **E2E:** `frontend/tests/e2e/run-alert.spec.ts` (update) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — drive the mocked running build; assert `run-alert` is present in the
  page content (e.g. it is NOT the viewport-pinned fixed bar — assert it scrolls with / sits
  within the content column, and appears after the page header) and that `run-stop` is an icon
  button (no visible "Stop" text; has an `aria-label`) that still POSTs `/api/stop/{run_id}`;
  alert clears on terminal status. Refresh the `run-alert.png` baseline to the new in-page layout
  at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

  **UAT:**
  1. Start a build. Confirm the alert now appears inside the page (below the title, above the
     main content), spanning the content width with margin above and below — not a bar stuck to
     the very top of the window.
  2. Confirm the Stop control is a small icon (X/stop) with a tooltip/label; click it and confirm
     the run cancels and the alert clears.
  3. Confirm View-logs still toggles the terminal and the alert still names the active command.

  **Verify:** `cd frontend && npx playwright test run-alert.spec.ts`

---

- [x] **XTF-13 — Build options for Express & regular build: split-by (main-table columns) + sample preview (`--split-sample`)**

  **Created:** 2026-06-18 · **Completed:** 2026-06-19

  Expose two build options on both build surfaces: a **split-by** selector populated with
  **main-table `export_label`s only** (not repeat-group columns) and a "build all (default) vs first
  N groups" sample-preview option mapping to `--split-sample N`, with discoverability copy so users
  know they can preview before a full split build. Both must reach (a) the Express Apply&build chain
  (Templates.jsx `applyAndBuild` ~87 → `/api/template/apply` then `run('build-report')` ~103) and
  (b) the regular build trigger (`Reports.jsx` ~115 `onClick: () => run('build-report')`). **Two
  gaps to fix:** `--split-sample` is NOT in `ALLOWED_COMMANDS["build-report"]` (web/main.py ~474 —
  currently `["--sample","--split-by","--session","--period","--compare"]`) and `useCommand.run`
  (frontend/src/hooks/useCommand.js ~26–33) does not forward a `split_sample` opt, so both must be
  added (CLI flag `--split-sample` already exists in `src/data/make.py` ~323 and `RunPayload` needs a
  `split_sample` field, web/main.py ~480). **Depends on XTF-8** (clean relative template resolution
  is required for the Express build to actually run) and **XTF-1–XTF-7** (shipped). The express and
  regular surfaces are similar enough (both call `run('build-report')` / `/api/run/build-report`) to
  ship as one deliverable behind a shared "build options" control; not split.

  **Files:** `web/main.py` (`ALLOWED_COMMANDS["build-report"]` add `--split-sample`; `RunPayload`
  add `split_sample`; map it into the build-report arg list) · `frontend/src/hooks/useCommand.js`
  (forward `opts.split_sample` into the request body) · `frontend/src/pages/Templates.jsx`
  (`ExpressFlow` — split-by + sample-preview control; pass to apply chain's `run('build-report',
  opts)`) · `frontend/src/pages/Reports.jsx` (build-options control on the regular Build trigger ~115)
  · a small shared options component if warranted · `tests/test_run_api.py` (new, or extend
  `tests/test_template_api.py`) · `frontend/tests/e2e/express-template-fill.spec.ts`

  **Config/schema impact:** None to `config.yml`. Adds `--split-sample` to the build-report
  whitelist and a `split_sample` field on `RunPayload` (already a CLI flag).

  **Acceptance criteria**
  - The split-by selector is populated **only** with main-table `export_label`s (questions whose
    `group` is the main table — repeat-group columns are excluded), sourced from the questions/config
    or an existing catalog endpoint
  - A sample-preview control offers "Build all groups (default)" vs "First N groups", mapping the
    chosen N to `--split-sample N`; discoverability copy explains it previews before a full build
  - `ALLOWED_COMMANDS["build-report"]` includes `--split-sample`; `RunPayload.split_sample` is
    accepted and forwarded into the build-report command line
  - `useCommand.run('build-report', {split_by, split_sample})` includes both in the POST body
  - The Express Apply&build chain passes the selected `split_by`/`split_sample` into its
    `run('build-report', …)` call; the regular Build trigger does the same
  - Selecting no split-by / "build all" produces the current behavior (no `--split-by`/no
    `--split-sample`)
  - Impeccable audit/critique clean on the new options control

  **Unit tests:** `tests/test_run_api.py` (or extend `tests/test_template_api.py`) — (1) assert
  `"--split-sample"` is in `ALLOWED_COMMANDS["build-report"]`. (2) `test_build_report_split_sample_forwarded`:
  POST `/api/run/build-report` with `{split_by: "Site", split_sample: 2}` (run seam mocked) and
  assert the constructed command carries `--split-by Site` and `--split-sample 2`. (3) assert a
  request omitting both yields neither flag.

  **E2E:** `frontend/tests/e2e/express-template-fill.spec.ts` (extend) + visual (impeccable
  audit/critique + `toHaveScreenshot`) — open the build-options control (express and/or regular),
  assert the split-by list contains only main-table labels (mock the catalog/config with one
  main-table and one repeat-group column; assert the repeat-group one is absent), select a split-by
  and "First 2 groups", trigger the build, and assert the `/api/run/build-report` request body carries
  `split_by` and `split_sample: 2`. Capture a `toHaveScreenshot` baseline of the build-options control
  at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

  **UAT:**
  1. With downloaded data, open the build options (Express Apply&build and/or Reports → Build).
     Confirm the split-by dropdown lists only main-table columns (no repeat-group fields).
  2. Pick a split-by column and choose "First 2 groups", then build. Confirm only two split reports
     are produced (preview), and the copy made clear this was a preview.
  3. Repeat with "Build all groups" and confirm a report is produced for every group.

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_run_api.py -k "split"` ·
  `cd frontend && npx playwright test express-template-fill.spec.ts`

---

- [x] **XTF-12 — Reports page: "Delete all reports" + bulk-delete endpoint**

  **Created:** 2026-06-18 · **Completed:** 2026-06-19

  `Reports.jsx` deletes reports one at a time (`deleteReport`, ~82) against
  `DELETE /api/reports/{filename}` (web/main.py ~1845, editor-gated). There is no bulk delete. Add a
  bulk `DELETE /api/reports` endpoint (same editor/admin RBAC as the single delete) and a "Delete all
  reports" button on the Reports page with a confirm dialog. Depends on **XTF-1–XTF-7** (shipped).
  Independent of XTF-8–XTF-11.

  **Files:** `web/main.py` (new `DELETE /api/reports` bulk handler near ~1845, `_require(request,
  "editor")`) · `frontend/src/pages/Reports.jsx` (a "Delete all" button + confirm, reusing the
  existing `confirm` dialog pattern at ~82–84; hidden/disabled for viewers via the existing `canEdit`
  gate) · `tests/test_reports_api.py` (new) · `frontend/tests/e2e/reports-delete-all.spec.ts` (new,
  or extend an existing reports spec)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - `DELETE /api/reports` deletes **all** `.docx` files in `REPORTS_DIR` and returns a count (e.g.
    `{ok: true, deleted: N}`); deleting an empty reports dir is a non-error no-op (`deleted: 0`)
  - The endpoint enforces editor/admin RBAC via `_require(request, "editor")` (a viewer gets 403),
    matching the single-file delete
  - Reports page shows a "Delete all reports" button that is hidden/disabled for viewers (existing
    `canEdit` gate) and prompts a confirm before deleting
  - After confirming, the report list empties and the empty-state copy shows
  - Impeccable audit/critique clean on the new control (destructive styling + clear confirm copy)

  **Unit tests:** `tests/test_reports_api.py` — (1) `test_delete_all_reports_removes_files`: seed
  `REPORTS_DIR` with two `.docx` files, `DELETE /api/reports` as editor, assert 200 with
  `deleted:2` and the dir is empty afterward. (2) `test_delete_all_reports_empty_noop`: with no
  reports, assert 200 with `deleted:0` and no error. (3) `test_delete_all_reports_rbac`: a viewer
  caller gets 403 and files are untouched.

  **E2E:** `frontend/tests/e2e/reports-delete-all.spec.ts` (new) + visual (impeccable audit/critique
  + `toHaveScreenshot`) — mock `/api/reports` to list two reports, mock `DELETE /api/reports` to
  succeed; click "Delete all reports", confirm in the dialog, and assert the list empties and the
  empty-state appears; assert the bulk `DELETE /api/reports` was called once. Capture a
  `toHaveScreenshot` baseline of the populated list with the "Delete all" button and of the confirm
  dialog at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

  **UAT:**
  1. Build two or more reports so the Reports list is populated. Confirm a "Delete all reports"
     button is visible (as an editor/admin).
  2. Click it, confirm the warning dialog, and confirm all reports disappear and the empty-state
     message shows.
  3. As a viewer, confirm the "Delete all reports" control is hidden or disabled.

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_reports_api.py` ·
  `cd frontend && npx playwright test reports-delete-all.spec.ts`

---

- [x] **XTF-11 — Terminal: show ~5s during a build then auto-collapse; auto-expand on error**

  **Created:** 2026-06-18 · **Completed:** 2026-06-19

  Today `onStatus` (App.jsx ~146–166) opens the terminal on `running`, and on `success` collapses it
  after a fixed 1400 ms; on `error` it forces it open. Change the build behavior so the terminal
  opens when a build run starts, stays visible for a short delay (default ~5s), then auto-collapses to
  its minimized bar **while the run continues** — and if the run ENDS IN ERROR, auto-expands again so
  the failure log is visible. Applies to express **and** normal builds. The delay MUST be testable
  without a real 5s wait (e.g. a module-level constant overridable via a test hook / Playwright fake
  timers — note this in the implementation). Depends on **XTF-1–XTF-7** (shipped). Independent of
  XTF-8/9/10.

  **Files:** `frontend/src/App.jsx` (`onStatus` open/collapse timing; replace the 1400 ms success
  collapse with the open→~5s→collapse-on-running behavior + auto-expand on error; expose the delay as
  an overridable constant) · `frontend/src/components/BottomTerminal.jsx` (collapse-to-bar /
  expand affordance hooks if needed) · `frontend/tests/e2e/express-template-fill.spec.ts` (or a new
  terminal spec)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - On a build run starting, the terminal opens; after the configured delay (default ~5s) it
    auto-collapses to the minimized bar **even though the run is still running**
  - If the run subsequently ends in **error**, the terminal auto-expands to show the failure
  - On a clean **success**, the terminal stays collapsed (it already collapsed during the run); no
    second flicker
  - The delay is driven by an overridable constant so tests can set it to a few ms — no real 5s wait
    in the E2E
  - Manual toggling (the nav terminal button / clicking the bar) still works and is not overridden by
    the auto-timing while the user has it open

  **Unit tests:** N/A (frontend-only timing; Vitest is not installed — covered by the Playwright E2E
  below using a short test-config delay / fake timers).

  **E2E:** `frontend/tests/e2e/express-template-fill.spec.ts` (extend, or a new
  `frontend/tests/e2e/terminal-collapse.spec.ts`) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — with the auto-collapse delay set to a few ms (test hook), drive a mocked
  long-running build: assert the terminal is open right after `running`, then assert it has collapsed
  to the bar (`[data-open="false"]`) after the delay while the run is still streaming; then emit an
  `error` status and assert the terminal auto-expands (`[data-open="true"]`). Capture a
  `toHaveScreenshot` baseline of both the collapsed-during-run state and the auto-expanded error state
  at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

  **UAT:**
  1. Start a build. Confirm the terminal opens and shows the run starting.
  2. Wait ~5 seconds and confirm it collapses to the slim bottom bar while the build keeps running.
  3. Trigger a build that fails (e.g. no charts configured) and confirm the terminal auto-expands so
     you can read the error.

  **Verify:** `cd frontend && npx playwright test express-template-fill.spec.ts`

---

- [x] **XTF-10 — Replace the run badge with a fixed "report building…" alert + stop/cancel**

  **Created:** 2026-06-18 · **Completed:** 2026-06-18

  Today an active run shows a small `run-indicator` button in the top nav (App.jsx ~323–329) that
  only toggles the terminal — there is no way to cancel a run from the UI even though
  `POST /api/stop/{run_id}` (web/main.py ~1773) and `useCommand`'s `stop` (with `runIdRef` from the
  SSE `run_id`, frontend/src/hooks/useCommand.js ~95) already exist. `lib/run.js`'s `RunContext` and
  App's `RunProvider` (App.jsx ~366) currently expose only `{run, running, activeCmd}` — `stop` is
  dropped. Replace the badge with a fixed, prominent alert shown whenever a run is active, carrying a
  stop/cancel control wired to the stop endpoint. Applies to express **and** normal runs. Depends on
  **XTF-1–XTF-7** (shipped). Independent of XTF-8/9.

  **Files:** `frontend/src/App.jsx` (destructure `stop` from `useCommand`; render the fixed alert in
  place of `run-indicator`; pass `stop` through `RunProvider`) · `frontend/src/lib/run.js`
  (add `stop` to the `RunContext` default + provider contract) · `frontend/src/hooks/useCommand.js`
  (already returns `stop` — no behavior change expected) · `frontend/src/styles.css` (alert styles) ·
  `frontend/tests/e2e/express-template-fill.spec.ts` (or a small new spec for the alert)

  **Config/schema impact:** None — reuses `POST /api/stop/{run_id}`.

  **Acceptance criteria**
  - Whenever `running` is true, a fixed alert (e.g. a top-of-app banner) is shown reading the active
    command (e.g. "Building report…"); the old `run-indicator` nav badge is removed
  - The alert has a visible Stop/Cancel control; clicking it calls `useCommand.stop()`, which POSTs
    to `/api/stop/{run_id}` (falling back to `/api/stop` when no `run_id` yet)
  - `stop` is exposed through `RunContext`/`RunProvider` so any run trigger (express Apply&build and
    the normal Build report) is cancellable from the same alert
  - When the run ends (success or error) the alert disappears
  - The alert is accessible (`role="status"` or `role="alert"` as appropriate; the stop button is a
    real `<button>` with an accessible label)
  - Impeccable audit/critique clean on the alert + stop control

  **Unit tests:** N/A (frontend-only; Vitest is not installed — covered by the Playwright E2E below).

  **E2E:** `frontend/tests/e2e/express-template-fill.spec.ts` (extend, or a new
  `frontend/tests/e2e/run-alert.spec.ts`) + visual (impeccable audit/critique + `toHaveScreenshot`) —
  mock `/api/run/build-report` to stream a long-lived SSE `running` status (including a `run_id`),
  trigger a build, and assert the fixed alert + Stop button are visible (and the old nav badge is
  gone); click Stop and assert `POST /api/stop/{run_id}` is called with that id; then emit a terminal
  status and assert the alert disappears. Capture a `toHaveScreenshot` baseline of the active-run
  alert at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

  **UAT:**
  1. Start a build (Reports → Build report, or Express Apply&build). Confirm a prominent fixed alert
     appears reading that a report is building, with a Stop/Cancel button (no small nav badge).
  2. Click Stop and confirm the run is cancelled (terminal shows it stopped) and the alert clears.
  3. Start another build and let it finish normally; confirm the alert disappears on completion.

  **Verify:** `cd frontend && npx playwright test express-template-fill.spec.ts`

---

- [x] **XTF-9 — Gate the "In a hurry?" Express banner on questions + data**

  **Created:** 2026-06-18 · **Completed:** 2026-06-18

  The `ExpressBanner` (frontend/src/pages/Templates.jsx ~14) always renders enabled, but inference
  can't validate proposals without real columns — `/api/template/infer` returns the
  `EXPRESS_NO_DATA_MESSAGE` precondition when no data is downloaded. Disable the banner with a hint
  until `has_questions` **and** `has_data` are both true, reusing the readiness flags from
  `GET /api/state` (web/main.py ~1790–1821, already returning `has_questions`/`has_data`). Depends on
  **XTF-1–XTF-7** (shipped). Independent of XTF-8.

  **Files:** `frontend/src/pages/Templates.jsx` (`ExpressBanner` — fetch/consume `/api/state`
  readiness, disabled state + hint) · `frontend/src/pages/Dashboard.jsx` (the Dashboard surface of
  the banner, if it renders one) · `frontend/tests/e2e/express-template-fill.spec.ts`

  **Config/schema impact:** None — reuses the existing `/api/state` readiness flags.

  **Acceptance criteria**
  - When `/api/state` reports `has_questions:false` OR `has_data:false`, the Express banner is
    disabled (not actionable) and shows a hint explaining what's needed first (e.g. "Download data
    and configure questions before using Express fill")
  - When both flags are `true`, the banner is enabled and opens the Express flow exactly as today
  - The banner's `data-testid="express-banner"` is preserved; disabled state is exposed
    accessibly (`disabled` / `aria-disabled` + the hint reachable to assistive tech)
  - Impeccable audit/critique clean on the gated banner (disabled affordance reads as intentionally
    unavailable, not broken)

  **Unit tests:** N/A (frontend-only gating; Vitest is not installed — the gate is asserted by the
  Playwright E2E below, consistent with XTF-7's gating coverage).

  **E2E:** `frontend/tests/e2e/express-template-fill.spec.ts` (extend) + visual (impeccable
  audit/critique + `toHaveScreenshot`) — mock `/api/state` → `{has_questions:false, has_data:false}`
  and assert the banner is disabled with the hint visible and does not open the flow on click; then
  mock `{has_questions:true, has_data:true}` and assert the banner is enabled and opens the Express
  flow. Capture a `toHaveScreenshot` baseline of the gated (disabled+hint) state at all three
  viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

  **UAT:**
  1. In a project with no downloaded data, open Templates. Confirm the "In a hurry?" banner is
     visibly disabled and shows a hint telling you to download data / configure questions first, and
     clicking it does nothing.
  2. Configure questions and run Download. Return to Templates and confirm the banner is now enabled.
  3. Click the enabled banner and confirm the Express flow opens.

  **Verify:** `cd frontend && npx playwright test express-template-fill.spec.ts`

---

- [x] **XTF-8 — Fix: Express apply persists the resolved template to durable storage + a relative `report.template`**

  **Created:** 2026-06-18 · **Completed:** 2026-06-18

  Bug found in review: `api_template_apply` (web/main.py ~2562) sets
  `cfg["report"]["template"]` to the **absolute** resolved path and never `put_project_file`s the
  resolved `.docx`. Web runs hydrate `templates/` from Minio into an isolated tempdir
  (`hydrate_run_dir`, `web/storage/workspace.py` ~145), so build-report can't find the file — and
  `sanitize_run_config` (~121) pins `export`/`report` output dirs but not `report.template`, so the
  absolute host-mirror path is read stale ("cached"). Fix: apply writes the resolved `.docx` under
  `TEMPLATES_DIR`, sets `report.template` to a **relative** `templates/<name>.resolved.docx`, and
  pushes it to durable storage via `storage_workspace.put_project_file(org_id, project_id,
  "templates", path)` — mirroring `set_active_template` (~2078). `delete_template` (~2054) clears /
  repoints `report.template` when the deleted file is the active one. Priority card; XTF-13 depends
  on it. Independent of XTF-9–XTF-12. Depends on **XTF-1–XTF-7** (shipped).

  **Files:** `web/main.py` (`api_template_apply` ~2532, `delete_template` ~2054) ·
  `web/storage/workspace.py` (`sanitize_run_config` — pin `report.template` to its relative form) ·
  `tests/test_template_api.py`

  **Config/schema impact:** None to the schema. `report.template` is now stored as a relative
  `templates/<name>` ref (the shape `set_active_template` already writes), not an absolute path.

  **Acceptance criteria**
  - After `/api/template/apply`, `cfg["report"]["template"]` is a **relative** path of the form
    `templates/<name>.resolved.docx` (no absolute path, no `..`)
  - The resolved `.docx` exists under `TEMPLATES_DIR` **and** has been pushed to durable storage via
    `put_project_file(... "templates" ...)` (so a subsequent run's `hydrate_run_dir` pulls it)
  - `sanitize_run_config` leaves the relative `report.template` intact (does not blank or absolutize
    it) so the hydrated tempdir resolves the same file build-report loads
  - `delete_template` on the file currently referenced by `report.template` clears or repoints the
    ref (no dangling absolute/relative path left in config)
  - The `/api/template/apply` response still returns `{ok, template, n_written}`; `template` is the
    relative ref

  **Unit tests:** `tests/test_template_api.py` — (1) `test_apply_persists_relative_template`: with
  `apply_inference` real (only the LLM/`infer_specs` seam mocked), POST approved proposals to
  `/api/template/apply` and assert `report.template` in the written config is relative
  (`templates/…`, not absolute) AND the resolved file was pushed to storage (assert via a fake/spy
  storage backend that `put_project_file` was called with category `"templates"` and the resolved
  filename). (2) `test_sanitize_run_config_keeps_relative_template`: `sanitize_run_config` on a cfg
  with `report.template: templates/x.resolved.docx` returns the same relative value. (3)
  `test_delete_active_template_clears_ref`: set `report.template` to a template, `DELETE
  /api/templates/<name>`, assert `report.template` is cleared/repointed (not dangling).

  **E2E:** N/A (back-end persistence/path fix — no UI surface of its own; the express UI flow is
  covered by XTF-5/XTF-6; human gate is the un-mocked integration test + PR review).

  **UAT:** N/A (back-end fix; verified via the Verify command, unit tests, the verifier, and PR
  review — UAT moves in lockstep with E2E).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_template_api.py -k "apply or sanitize or delete"`

---

- [x] **XTF-7 — Gate the Express "Infer" button on AI-tested status (parity with other AI buttons)**

  **Created:** 2026-06-18 · **Completed:** 2026-06-18

  The Express **Infer** button is enabled as soon as a file is chosen (`disabled={!file || loading}`)
  — unlike every other interactive AI control, which stays disabled until the AI connection is
  configured **and** verified via `/api/ai/test` (`useAiStatus().aiReady` + `AI_LOCK_TIP`). Bring
  Infer to parity so users get the same "Test the AI connection first" affordance instead of
  clicking into a backend error message. Independent of XTF-6.

  **Files:** `frontend/src/pages/Templates.jsx` (`useAiStatus`; `disabled={!aiReady || !file || loading}`;
  `AI_LOCK_TIP` tooltip when locked) · `frontend/tests/e2e/express-template-fill.spec.ts` (assert
  the gate via mocked `/api/ai/status`)

  **Config/schema impact:** None — reuses the existing `/api/ai/status` + `aiStatus` context.

  **Acceptance criteria**
  - With AI not configured/verified (`/api/ai/status` → `aiReady:false`), the Infer button is
    disabled and exposes the `AI_LOCK_TIP` ("Test the AI connection first …") tooltip, even when a
    file is chosen
  - With `aiReady:true`, Infer enables once a file is chosen (current behavior preserved)
  - The discoverability banner still opens the flow regardless (it triggers no AI call); only Infer
    is gated
  - Matches the lock/tooltip pattern used by the Composition suggester buttons

  **Unit tests:** N/A (frontend-only gating; Vitest is not installed — the gate is asserted by the
  Playwright E2E below, consistent with XTF-5's Apply&build gating coverage).

  **E2E:** `frontend/tests/e2e/express-template-fill.spec.ts` (extend) + visual — mock
  `/api/ai/status` → `{aiReady:false}` and assert Infer is `disabled` with the lock tooltip; then
  `{aiReady:true}` and assert it enables after choosing a file. Capture a `toHaveScreenshot`
  baseline of the locked state at all three viewports (mobile 390×844, tablet 820×1180, desktop
  1440×900). impeccable audit/critique clean on the changed control.

  **UAT:**
  1. With no AI provider configured (or configured but not tested), open Templates → Express fill.
     Confirm the **Infer** button is disabled and hovering shows "Test the AI connection first".
  2. Configure + test the AI connection (Extract → AI configuration). Return to Express fill,
     choose a `.docx`, and confirm **Infer** is now enabled.
  3. Confirm the "In a hurry?" banner still opens the Express flow even when AI is untested.

  **Verify:** `cd frontend && npx playwright test express-template-fill.spec.ts`

---

- [x] **XTF-6 — Fix: persist the uploaded template across infer → apply**

  **Created:** 2026-06-18 · **Completed:** 2026-06-18

  Bug found in review: `POST /api/template/infer` writes the uploaded `.docx` to a throwaway
  temp file and never persists it; the panel then calls `POST /api/template/apply` with only the
  client `file.name`, which `apply` resolves by basename against `TEMPLATES_DIR` — where a
  freshly-uploaded file was never stored. So apply hits a non-existent path and can't resolve the
  template. The network-mocked XTF-5 tests missed it (both endpoints / `apply_inference` mocked).
  Independent of XTF-7.

  **Files:** `web/main.py` (`api_template_infer` persists the upload + returns a stable ref;
  `api_template_apply` resolves that ref) · `frontend/src/pages/Templates.jsx` (carry the
  infer-returned ref into apply instead of `file.name`) · `tests/test_template_api.py` (real,
  un-mocked infer→apply integration test) · `frontend/tests/e2e/express-template-fill.spec.ts`
  (update the infer route-mock to return the ref so the flow contract stays valid)

  **Config/schema impact:** None. Uploaded templates are persisted under `TEMPLATES_DIR` (or a
  per-session dir) — same storage the normal template upload uses.

  **Acceptance criteria**
  - `api_template_infer` persists the uploaded `.docx` to a stable location and returns a
    resolvable `template` ref in its response (alongside `proposals`)
  - The panel carries that returned ref into `api_template_apply` (no longer the bare client
    `file.name`)
  - `api_template_apply` resolves the persisted file and runs `apply_inference` against it; if the
    ref cannot be resolved it returns a clear error (no traceback / no silent wrong-path)
  - A real **un-mocked** integration test exercises infer→apply end to end (only the LLM seam
    mocked, NOT `apply_inference`/`extract_placeholders`): the resolved template exists and config
    is written
  - The `express-template-fill.spec.ts` E2E is extended so its infer route-mock returns the ref
    and the full upload → Infer → approve → Apply&build flow reaches success (not an apply error)

  **Unit tests:** `tests/test_template_api.py::test_infer_apply_roundtrip_real` — a real
  infer→apply integration test: POST a multipart `.docx` to `/api/template/infer` (LLM/`infer_specs`
  mocked, but `extract_placeholders` and the persistence path real), capture the returned
  `template` ref, POST it with approved proposals to `/api/template/apply` calling the REAL
  `apply_inference`, and assert the resolved `.docx` exists on disk + config gained the chart
  section + response `{ok, template, n_written}`. Plus a negative case: apply with an unresolvable
  ref returns a clear error, not a 500 traceback.

  **E2E:** `frontend/tests/e2e/express-template-fill.spec.ts` (extend) + visual — drive the full
  upload → Infer → approve → **Apply&build** flow with the infer route-mock returning the persisted
  template ref; assert apply succeeds (`express-success` shows the resolved name) rather than
  erroring. `toHaveScreenshot` baseline of the success state at all three viewports (mobile
  390×844, tablet 820×1180, desktop 1440×900). impeccable audit/critique clean on the changed flow.

  **UAT:**
  1. Templates → Express fill. Click "Choose .docx" and pick a template that has NOT been
     previously uploaded/saved. Confirm its name appears.
  2. Click Infer; wait for the proposal rows; click **Apply & build**.
  3. Expected: the success banner shows the resolved template name and a build-report run starts —
     no "Apply failed" / path error; the report appears under the Reports tab.
  4. Tamper the apply ref (devtools) to a name that does not exist server-side and confirm a clear
     inline error, not a 500/traceback.

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_template_api.py -k "upload or apply or infer"`

---

- [x] **XTF-5 — Web review/approve panel + discoverability**

  **Created:** 2026-06-18 · **Completed:** 2026-06-18

  The user-facing card: a Templates-tab review/approve panel over the proposals, the two API
  endpoints, and a discoverability banner/button. Depends on **XTF-1**, **XTF-2**, **XTF-3**,
  **XTF-4**.

  **Files:** `web/main.py` (`POST /api/template/infer`, `POST /api/template/apply`;
  `ALLOWED_COMMANDS`) · `frontend/src/pages/Templates.jsx` (review/approve panel) ·
  `frontend/src/pages/Dashboard.jsx` (discoverability banner/button) ·
  `tests/test_template_api.py` (new) · `frontend/tests/e2e/express-template-fill.spec.ts` (new
  Playwright spec)

  **Config/schema impact:** None — endpoints proxy the `template_inference` module + existing
  run endpoint.

  **Acceptance criteria**
  - `POST /api/template/infer` (multipart upload or existing-template ref) loads the latest
    session and runs parse → infer → annotate, returning `{proposals, message?}`
  - Precondition payloads are friendly: no AI provider/key →
    "Configure an AI provider to use Express fill."; no downloaded data →
    "No data yet — run Download first."
  - `POST /api/template/apply` `{proposals}` runs `apply_inference` and returns
    `{ok, template, n_written}`; the client then calls the existing `build-report` run endpoint
  - Templates tab shows a review table: placeholder → proposed kind / canonical name / spec, with
    `needs_attention` rows highlighted and showing the reason; each row is editable
    (kind/spec/name) or droppable
  - **Apply & build** is disabled while any row is `needs_attention` (unless the user drops the
    flagged ones); loading/empty/error states mirror `Validate.jsx` / `Ask.jsx`
  - A discoverability banner/button on Dashboard + Templates ("In a hurry? Upload a template and
    let AI fill it →") opens the express flow; the 5-step pipeline remains the default and
    unchanged
  - Impeccable audit/critique clean on the new panel (no UX/accessibility findings)

  **Unit tests:** `tests/test_template_api.py` — `/api/template/infer` returns the no-AI message
  payload when no provider is configured; returns the "run Download first" payload when no data
  exists; returns `{proposals: [...]}` (LLM mocked) when AI + data are present; resolves an
  existing-template ref (not just a multipart upload) to the correct stored template;
  `/api/template/apply` with approved proposals writes config and returns
  `{ok, template, n_written}` with the resolved template path. (Plus a Vitest component test for
  the Templates panel: a `needs_attention` row disables **Apply & build** until edited or
  dropped.)

  **E2E:** Playwright spec `frontend/tests/e2e/express-template-fill.spec.ts` + visual (impeccable
  audit/critique + `toHaveScreenshot`) — click the discoverability banner → upload a template →
  infer → assert the review panel shows the placeholder → kind/name mapping with a flagged row
  highlighted → edit/resolve the flagged row → assert **Apply & build** enables → click it →
  assert the report downloads. Capture a `toHaveScreenshot` baseline of the review panel
  (flagged + resolved states) at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

  **UAT:**
  1. From the Dashboard, click the "In a hurry?" banner. Confirm the express flow opens and the
     5-step pipeline is still the default elsewhere.
  2. Upload a template and run infer. Confirm the review panel lists each placeholder with its
     proposed kind/name and that low-confidence/invalid rows are highlighted with a reason.
  3. Edit or drop the flagged row, confirm **Apply & build** enables, click it, and confirm a
     report is produced. Then run infer with no AI provider and confirm the friendly
     "Configure an AI provider" message appears instead of a crash.

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_template_api.py` ·
  Playwright: `npx playwright test express-template-fill.spec.ts`

---

- [x] **XTF-4 — CLI commands (`infer-template`, `apply-template`)**

  **Created:** 2026-06-18 · **Completed:** 2026-06-18

  Two-phase CLI so review can happen between inference and apply, with a JSON proposal artifact
  and an optional `--build` chain. Depends on **XTF-1**, **XTF-2**, **XTF-3**.

  **Files:** `src/data/make.py` (`infer-template`, `apply-template` Click commands) ·
  `web/main.py` (`ALLOWED_COMMANDS` + allowed flags) · `tests/test_template_inference.py`

  **Config/schema impact:** None. Two new whitelisted commands in `ALLOWED_COMMANDS`.

  **Acceptance criteria**
  - `infer-template --template <file> [--out reports/.template_inference.json]` runs
    `extract_placeholders` → `infer_specs` → `annotate_proposals`, writes the proposal list to
    the `--out` JSON, and prints a summary table (placeholder → kind / name / status)
  - `infer-template` errors clearly when no AI provider/key is configured, and when no data has
    been downloaded (local validation needs real columns)
  - `apply-template [--from reports/.template_inference.json] [--build]` reads the (possibly
    user-edited) proposals, drops any still flagged/unapproved, runs `apply_inference` (writes
    config + resolved template); with `--build` it chains into `build-report`
  - Both commands added to `ALLOWED_COMMANDS` in `web/main.py` with only their allowed flags
  - Zero placeholders found → a friendly no-op message, non-error exit

  **Unit tests:** `tests/test_template_inference.py` — invoke commands via Click's
  `CliRunner` with the LLM mocked. Cases: `infer-template` writes the `--out` JSON with one
  entry per non-literal token and exits 0; `infer-template` with no AI config exits non-zero with
  a message naming the AI provider requirement; `infer-template` with no downloaded data exits
  with the "run Download first" message; `apply-template --from <json>` writes config + resolved
  template and drops a `needs_attention` proposal that was not approved; `apply-template --build`
  invokes the `build-report` path (assert the chained call via `ctx.invoke`/mock); a template
  with zero placeholders prints the no-op message and exits 0; assert both command names are in
  `ALLOWED_COMMANDS`.

  **E2E:** N/A (no UI surface — CLI commands; the UI flow is covered by XTF-5)

  **UAT:** N/A (CLI, no web-UI surface — verified via the Verify command, unit tests, the verifier, and PR review).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_template_inference.py -k "cli or command"`

---

- [x] **XTF-3 — Apply: persist config + resolve template (`apply_inference`)**

  **Created:** 2026-06-18 · **Completed:** 2026-06-18

  Write approved specs into `config.yml` without clobbering, and rewrite each token's run span to
  a single clean `{{ canonical }}` run so docxtpl renders it (critical for charts). Depends on
  **XTF-1** and **XTF-2**.

  **Files:** `src/reports/template_inference.py` (`apply_inference`) ·
  `tests/test_template_inference.py`

  **Config/schema impact:** None — appends to existing `charts`/`indicators`/`summaries`/`report`
  sections using the established config shapes via `write_config`.

  **Acceptance criteria**
  - `apply_inference(approved, cfg, template_path) -> (cfg, resolved_template_path)`
  - Appends/merges each approved spec into the correct config section
    (`chart_<slug>`/`ind_<slug>`/`summary_<slug>`/`table_<slug>`, narrative slots, `report.*`)
  - Never clobbers existing user-authored entries; dedupes by name (suffix on collision)
  - Each token's run span is replaced by a single clean `{{ canonical }}` run, with the other
    runs in the span cleared — so every chart placeholder is exactly one unbroken XML run
  - Resolved `.docx` is saved as the project template; the original upload is preserved alongside
    it; the resolved path is returned
  - Output template is consumable by the unchanged `build-report` (no build-report changes)

  **Unit tests:** `tests/test_template_inference.py` — Cases: `apply_inference` writes a chart
  proposal into `config["charts"]` and an indicator into `config["indicators"]` with the expected
  shapes; pre-seed config with a user-authored `chart_existing` and assert it survives apply
  (no clobber) while the new entry is appended; two approved specs with the same base slug are
  written under distinct suffixed names; open the resolved `.docx` with `python-docx` and assert
  the chart placeholder occupies exactly one run (run count == 1 for that paragraph's placeholder)
  with text `{{ chart_<slug> }}`; assert the original uploaded `.docx` still exists after apply.

  **E2E:** N/A (no UI surface — config + docx resolution)

  **UAT:** N/A (no UI surface — verified via the Verify command, unit tests, the verifier, and PR review).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_template_inference.py -k apply`

---

- [x] **XTF-2 — Batched inference + local validation (`infer_specs`, `annotate_proposals`)**

  **Created:** 2026-06-18 · **Completed:** 2026-06-18

  One batched LLM call turns NL placeholders + the data catalog into config-shaped `Proposal`s,
  then deterministic local validation flags anything unsupported. Depends on **XTF-1**.

  **Files:** `src/reports/template_inference.py` (`infer_specs`, `annotate_proposals`) ·
  `src/utils/seed_prompts.py` (add `template_inference` seed with `output_schema`) ·
  `CLAUDE.md` + `docs/reference/prompts.md` (document the new `template_inference` prompt site) ·
  `tests/test_template_inference.py`

  **Config/schema impact:** None to `config.yml` schema. Adds one new prompt site
  (`template_inference`) to `SEED_PROMPTS`.

  **Acceptance criteria**
  - The new `template_inference` prompt site is documented in `CLAUDE.md` (prompt count/list)
    and the `docs/reference/prompts.md` prompt↔file↔contract table
  - `infer_specs(nl_tokens, catalog, ai_cfg)` makes a single batched call via
    `lf_client.get_prompt("template_inference", vars)` + `lf_client.chat(trace_name=
    "template_inference", json_mode=True)`, where `catalog` is `ask_engine.build_catalog`
  - Returns one `Proposal` per token: `{token_index, kind ∈ chart|indicator|summary|table|
    narrative|metadata, spec (config-shaped dict), name (canonical slug), confidence 0..1,
    reason}`
  - `template_inference` seed exists in `seed_prompts.py` with a JSON `output_schema` so it works
    offline via the bundled seed
  - `annotate_proposals(proposals, profile)` reuses `validate_recipe` / `CHART_REQS` /
    `INDICATOR_STATS` from `ask_engine.py` to set `status: ok` or `status: needs_attention`
    with a human-readable reason
  - `needs_attention` is set when confidence is low, validation fails, or a referenced column is
    absent from the downloaded data
  - Canonical `name`s are deduped (suffix on collision)
  - narrative kinds map to a fixed slot (`summary_text`/`observations`/`recommendations`) when
    the text clearly matches, else a `summaries` entry with `stat: ai` + `prompt` = placeholder
    text; metadata maps to `report.title`/`report.period`/etc.

  **Unit tests:** `tests/test_template_inference.py` — mock the LLM call like the existing
  suggester tests (`tests/` AI-suggester pattern). Cases: `annotate_proposals` flags a proposal
  with confidence below threshold as `needs_attention`; flags a proposal whose `spec` references
  a column absent from the profile; flags a bad type/column combo (scatter spec with only one
  quantitative column) via `validate_recipe`/`CHART_REQS`; passes a valid bar/indicator/summary
  proposal as `status: ok`; two proposals resolving to the same slug get suffixed distinct
  `name`s; a narrative token matching "recommendations" maps to the `recommendations` slot while
  a free-form narrative maps to a `summaries` entry with `stat: ai`; `infer_specs` issues exactly
  one `lf_client.chat` call for N tokens (assert call count == 1).

  **E2E:** N/A (no UI surface — back-end inference/validation)

  **UAT:** N/A (no UI surface — verified via the Verify command, unit tests, the verifier, and PR review).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_template_inference.py -k "infer or annotate"`

---

- [x] **XTF-1 — Placeholder extraction from .docx (`extract_placeholders`)**

  **Created:** 2026-06-18 · **Completed:** 2026-06-18

  Parse all three delimiters out of an uploaded `.docx` into structured `Token`s. Pure
  function, no AI, no network. Foundation for the rest of the express path.

  **Files:** `src/reports/template_inference.py` (new — `extract_placeholders`, `Token`) ·
  `tests/test_template_inference.py` (new)

  **Config/schema impact:** None — read-only over an uploaded `.docx`.

  **Acceptance criteria**
  - Walks body paragraphs, table cells, headers, and footers; reconstructs full paragraph text
    by concatenating runs so tokens split across runs are still matched
  - Matches `[[ … ]]`, then `[ … ]`, then `{{ … }}` in that precedence (a `[[x]]` token is
    matched once as `[[x]]`, never double-matched as `[x]`)
  - Each `Token` records `raw`, `inner` (trimmed inner text), `delimiter`, and a `location`
    (paragraph + run-span reference sufficient to rewrite the token later)
  - A `{{ }}` token whose `inner` matches a known literal placeholder (`report_title`, `period`,
    `n_submissions`, `generated_at`, `summary_text`, `observations`, `recommendations`,
    `chart_*`, `ind_*` incl. `_table`/`_breakdown`, `summary_*`, `table_*`, `data_quality*`,
    `logframe*`, `provenance.footer`) is marked `kind: literal` and left untouched
  - All non-literal tokens are returned for downstream inference

  **Unit tests:** `tests/test_template_inference.py` — build `.docx` fixtures programmatically
  with `python-docx`. Cases: each delimiter matched individually; precedence (`[[Total]]` is one
  token, not `[Total]`); a token whose characters span multiple runs is matched as one token;
  tokens located in a table cell, a header, and a footer are all extracted; a `{{ chart_sales }}`
  / `{{ report_title }}` literal is returned with `kind: literal` and unchanged `raw`; a
  `{{ unknown thing }}` non-literal is returned as an NL token; `location` round-trips (the
  recorded run-span identifies the same runs).

  **E2E:** N/A (no UI surface — pure parsing function)

  **UAT:**
  1. Create a `.docx` containing one placeholder of each delimiter in the body, one in a table
     cell, one in a header, and one in a footer. Call `extract_placeholders` and confirm all
     five are returned.
  2. Hand-type a placeholder so Word splits it across runs (e.g. autocorrect/formatting), and
     confirm it is still returned as a single token.
  3. Include `{{ report_title }}` and confirm it comes back marked `literal` with its `raw`
     text unmodified.

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_template_inference.py -k extract`

---

