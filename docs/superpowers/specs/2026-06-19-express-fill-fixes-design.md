# Express Fill fixes — design

Date: 2026-06-19
Branch: `feature/express-fill-fixes` (off `develop`)
Status: approved (brainstorm), pending roadmap cards

Four issues reported against the **Express fill** flow (Templates tab) and the report
pipeline behind it. Issues ①②③ are bugs; issue ④ is a feature (deterministic
auto-modeling of cross-table columns).

---

## ① Split preview ("First N groups") still produces every report

### Symptom
With `split_by = Commune` and "First N groups (preview)" `N = 2`, the Reports tab still
lists all groups (e.g. 26 files). Manually clicking "Delete all reports" then re-running a
2-group preview still yields all reports.

### Root cause
The splitter and the frontend wiring are correct:
- Frontend forwards `{split_by, split_sample}` from `BuildOptions` →
  `applyAndBuild(buildOpts)` → `run('build-report', buildOpts)`
  ([Templates.jsx:271](../../../frontend/src/pages/Templates.jsx#L271),
  [BuildOptions.jsx](../../../frontend/src/components/BuildOptions.jsx),
  [useCommand.js](../../../frontend/src/hooks/useCommand.js)).
- `--split-sample` reaches `ReportBuilder.build`, which slices to the first N values
  ([builder.py:120-122](../../../src/reports/builder.py#L120-L122)).
- `build-report` runs in an isolated tempdir whose inputs are `["processed","templates"]`
  ([workspace.py:110](../../../web/storage/workspace.py#L110)) — **not** `reports`. So the
  tempdir contains exactly this run's output: 2 files.

The fault is in **persisting** outputs. `push_outputs` is **merge-only**
([workspace.py:64-72](../../../web/storage/workspace.py#L64-L72)): it uploads the 2 new
files but never deletes the stale objects already in durable storage. Then
`_persist_run_outputs` → `pull_workspace` wipes the local mirror and re-downloads
**everything** from storage ([main.py:1683-1697](../../../web/main.py#L1683-L1697)), so the
local `reports/` ends up with all stale files again. Durable storage is acting as an
un-pruned cache. Manual "Delete all reports" doesn't help because it only unlinks local
files (see ②).

### Fix
Make `push_outputs` mirror (delete-extra) **only for the categories a command actually
produces** — never blanket, because e.g. `download` hydrates neither `reports` nor
`templates` and a blanket mirror would wipe them from storage.

- Add a per-command output map, e.g. `RUN_OUTPUTS = { "build-report": ["reports"],
  "run-all": ["reports"], "generate-template": ["templates"],
  "ai-generate-template": ["templates"], "download": ["processed"], ... }`. Commands with
  no declared outputs prune nothing.
- `push_outputs` (or `_persist_run_outputs`, which knows the command) computes, for each
  declared output category, the set of storage keys under that prefix that are **not**
  present in the local/tempdir set, and deletes them. All other categories stay merge-only.
- Requires storage primitives `list(prefix)` (exists) and a single-key delete (`delete` /
  `delete_project_file` exists). No new S3 calls beyond list + delete.

### Tests
- Unit: after a `build-report` run producing 2 reports into a tempdir that had 26 stale
  objects in storage, storage and the pulled local mirror contain exactly 2.
- Unit: a `download` run (no `reports` output) leaves existing `reports`/`templates`
  objects in storage untouched (regression guard against the footgun).

---

## ② Filename date does not match the "Generated" column

### Symptom
Files named `..._20260615.docx` / `..._20260618.docx` show "Generated 2026-06-19 12:07".

### Root cause
- Most of the confusion is stale files from ① (their names carry their original build date;
  the filename date itself is correct — `datetime.today()` at build,
  [builder.py:244](../../../src/reports/builder.py#L244)).
- The "Generated" column is the **local file mtime** in `GET /api/reports`
  ([main.py](../../../web/main.py)). `pull_workspace` re-downloads from S3, and boto3's
  `download_file` resets local mtime to download time — so every pulled file shows the
  pull time, not its build/push time.
- `DELETE /api/reports` (all + single) only unlinks local files; storage is untouched, so
  deletes don't survive a re-activate / next run's `pull_workspace`.

### Fix
1. `GET /api/reports` reports each file's **storage object last-modified** (the push/build
   time) instead of local mtime; fall back to local mtime when running in pure-local mode
   without a storage object. (Filename date is already correct and unchanged.)
2. `DELETE /api/reports` and `DELETE /api/reports/{filename}` also delete the corresponding
   storage object(s) (`delete_project_file`), so manual cleanup is durable.

Fixing ① removes the stale files that made the mismatch visible; this makes the displayed
timestamp meaningful and deletes durable.

### Tests
- Unit: listing returns the storage last-modified, not the (reset) local mtime.
- Unit: `DELETE /api/reports` removes both local files and storage objects; a subsequent
  `pull_workspace` finds nothing to restore.

---

## ③ Split-by dropdown is hidden after Infer (z-index / clipping)

### Symptom
In the Express review panel, the "Split by" combobox menu is clipped/hidden behind sibling
content when opened.

### Root cause
`.express-review-panel { overflow: hidden }`
([styles.css:925](../../../frontend/src/styles.css#L925)) clips the absolutely-positioned
`.build-combo__list` (`position:absolute; z-index:30`,
[styles.css:1014-1020](../../../frontend/src/styles.css#L1014-L1020)).

### Fix
Allow the menu to escape its container. Preferred: remove `overflow: hidden` from
`.express-review-panel` (it exists for border-radius cosmetics; verify nothing depends on
it) and ensure the combo list stacks above sibling rows. Fallback if rounded corners
regress: keep overflow but raise `.build-combo` into its own stacking context so the menu
renders above neighbours (or render the menu upward).

### Tests
- E2E (Playwright): after Infer, open "Split by"; assert the listbox is visible and not
  clipped. Visual `toHaveScreenshot` at the three viewports (mobile/tablet/desktop);
  human approves the new baseline.

---

## ④ Infer rejects columns that live in repeat-group tables (auto-modeling)

### Symptom
A placeholder whose column lives in a repeat-group base table (e.g. *"Existe-t-il une
structure de santé/USB opérationnelle?"*) is flagged: `column '…' not found in 'main'`.

### Root cause
The inference catalog already includes **all** tables (main + repeat groups), and the
report builder's `_pick_df()` already auto-selects the right table at build time
([builder.py:34-71](../../../src/reports/builder.py#L34-L71)). But the **validation** step
defaults `source` to `"main"` and rejects anything not found there
([ask_engine.py:96-108](../../../src/reports/ask_engine.py#L79-L116),
[template_inference.py:306-327](../../../src/reports/template_inference.py#L306-L327)).

### Approach (decisions made during brainstorm)
- **Hybrid (C):** stamp `source` for the single-table case; synthesize a persisted view
  only when a placeholder genuinely needs columns from a repeat table **and** main.
- **Deterministic (A):** a plain-Python resolver runs **after** `infer_specs`, **before**
  `annotate_proposals` — no extra LLM tokens, reproducible, works offline. The LLM keeps
  proposing kind + columns only.
- **Best-guess then flag (A):** use the `_pick_df` "most-columns-match" heuristic; only when
  a column is in **no** table or is a genuine tie, leave the existing `needs_attention`
  flag, with a reason naming the candidate tables.

### Design
New deterministic pass `resolve_sources(proposals, profile)` (in
`src/reports/template_inference.py` or a small module it imports). For each data proposal
(chart / indicator / summary / table):

1. Collect referenced columns (`questions` + `group_by`).
2. Map each column to the table(s) in `profile` that contain it.
3. **All in `main`** → leave as-is.
4. **All in one non-main table** → stamp `source: <table>` (heuristic picks when a column
   appears in several tables: the table containing the most of the spec's columns).
5. **Span a repeat table + main** (the join case) → synthesize a view:
   `{name, source: <repeat_table>, join_parent: [<main cols referenced>]}`; carry
   `group_by`/`question`/`agg` only when the chart is inherently aggregated. Point the
   spec's `source` at the new view name.
6. **Stuck** (column in no table, or unresolved tie) → keep `needs_attention` with a reason
   listing candidate tables.

**View persistence:** synthesized views are written into `config.yml` `views:` on
**apply** (`/api/template/apply`), not on infer. Names are deterministic and collision-safe
(e.g. `auto_<repeat_leaf>__<joincols>`, de-duped against existing `views:`) so re-running
Infer on the same template is idempotent (no duplicate views).

**Validation:** `_validate_chart` / `_validate_data_proposal` already validate against the
resolved `source`; once the resolver stamps it, a correct spec passes. No change to the
defaulting logic beyond the resolver running first.

### Wiring
- `/api/template/infer` ([main.py:2513-2551](../../../web/main.py#L2513)): run
  `resolve_sources` between `ti.infer_specs` and `ti.annotate_proposals`. Proposals returned
  to the UI carry resolved `source` and any pending synthesized-view definitions.
- `/api/template/apply` ([main.py:2559-2618](../../../web/main.py#L2559)): persist any
  synthesized views into the config `views:` section alongside the chart/etc. specs.

### Tests
- Unit: a chart referencing a single repeat-group column gets `source` stamped to that
  table; validates clean (no `needs_attention`).
- Unit: a chart referencing a repeat column + a main column yields a synthesized view with
  `source` = repeat table and `join_parent` = [main col]; spec sources the view.
- Unit: re-running the resolver is idempotent (no duplicate view names).
- Unit: a column present in no table stays `needs_attention` with a reason saying no table
  contains it; a genuine multi-table tie stays flagged with both candidate tables named.
- E2E: the `TestWithTheresa.docx` case (repeat-group column) no longer flags
  `column '…' not found in 'main'` and reaches Apply & build.

---

## Cross-cutting notes
- All code changes are gated by the repo's `/roadmap` flow: cards → tests-first
  (`roadmap-test-author`) → implement (`roadmap-task-implementer`) → DoD verify. This spec
  feeds card authoring; it is not a substitute for the cards.
- Likely card split: **(1)** storage mirror-on-output (①), **(2)** reports listing +
  durable delete (②), **(3)** Express dropdown CSS (③, UI/visual), **(4)** deterministic
  auto-modeling resolver (④). (1) and (2) share storage primitives and may be ordered
  together.
- Branching: work on `feature/express-fill-fixes` (and/or per-card derived branches) off
  `develop`; PR → `develop`. `main`/`develop` are merge-only.
