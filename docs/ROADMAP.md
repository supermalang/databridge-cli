# Roadmap — databridge-cli

> Consolidated planning. Each task carries: implementation · acceptance criteria · how to
> verify · config/schema impact.
> Items here are intentionally *not* enabled in the UI yet — many render as disabled "soon"
> affordances so users know they're coming.
>
> Legend: `- [ ]` todo · `- [x]` done.
> "Done" gate: implementation + its tests passing —
> `PYTHONPATH=. MPLBACKEND=Agg python -m pytest`. UI-only tasks verify visually in the dev
> server (`./scripts/dev.sh`).

---

## Global status

| Area | Planned | Progress |
|---|---|---|
| [Output / export formats](#output--export-formats) | 3 | 0 / 3 |
| [Project management & top ribbon (UX)](#project-management--top-ribbon-ux) | 9 | 0 / 9 |
| [M&E capabilities](#me-capabilities) | 5 | 0 / 5 |

> **Shipped foundations** (delivered, not tracked here): results framework / logframe
> (`framework:`, `{{ logframe }}`), indicator baseline+target with `pct_achievement`, the
> data-quality framework (`{{ data_quality }}`, completeness / outlier / duplicate rates),
> multi-period tracking (`periods:`), per-project Postgres + Minio storage, and per-project
> RBAC. See `CLAUDE.md`.

---

## Output / export formats

> The **Deliver → Output** tab ships **CSV** and **XLSX** data-file exports today
> (`export.format`). The targets below are designed in the config schema and have
> CLI/back-end support, but are gated off in the UI until verified end-to-end per project.
> To re-enable a format: drop its `soon: true` flag in `FORMATS`
> ([frontend/src/pages/Sources.jsx](../frontend/src/pages/Sources.jsx)) and confirm the
> matching `_export_*` path in [src/data/transform.py](../src/data/transform.py).

---

- [ ] **OUT-1 — JSON export (records array)**

  Surface JSON in the format chip-tabs and verify the `_export_file` JSON branch end-to-end.

  **Files:** `frontend/src/pages/Sources.jsx` (`FORMATS`) · `src/data/transform.py` (`_export_file`)

  **Config/schema impact:** None — `export.format: json` already accepted.

  **Acceptance criteria**
  - JSON chip selectable in Deliver → Output (no `soon` badge)
  - `download` writes a records-array `.json` to `export.output_dir`
  - Round-trips with PII redaction applied (same gate as CSV/XLSX)

  **Verify:** set `export.format: json`, run `download --sample 20`, open the output file.

---

- [ ] **OUT-2 — MySQL remote table export**

  Enable the MySQL target (credentials in `export.database`) once verified against a live DB.

  **Files:** `frontend/src/pages/Sources.jsx` (`FORMATS`) · `src/data/transform.py` (`_export_sql`)

  **Config/schema impact:** None — `export.database` schema exists; `sqlalchemy` + driver are
  optional imports inside `_export_sql`.

  **Acceptance criteria**
  - MySQL chip selectable; `export.database` fields shown
  - `download` creates/replaces `export.database.table` with redacted rows
  - Missing driver → clear, non-crashing error message

  **Verify:** point `export.database` at a scratch MySQL, run `download --sample 20`, inspect
  the table.

---

- [ ] **OUT-3 — PostgreSQL remote table export**

  Same as OUT-2 for PostgreSQL.

  **Files:** `frontend/src/pages/Sources.jsx` (`FORMATS`) · `src/data/transform.py` (`_export_sql`)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - PostgreSQL chip selectable; `export.database` fields shown
  - `download` creates/replaces the target table with redacted rows
  - Reuses the `_export_sql` path (no Postgres-specific branch needed)

  **Verify:** point `export.database` at a scratch Postgres, run `download --sample 20`,
  inspect the table.

---

## Project management & top ribbon (UX)

> Findings from a UX audit of the project switcher / create-edit form / profile / members
> flow (shipped in #63). Grouped by impact.

### High

---

- [ ] **UX-1 — Show project color & icon**

  The create/edit form collects a color + emoji icon, but they're rendered nowhere — the
  switcher avatar still shows `name.slice(0,2)` and menu rows are text-only.

  **Files:** [frontend/src/App.jsx](../frontend/src/App.jsx) · project-menu rows · project list

  **Config/schema impact:** None — fields already persisted.

  **Acceptance criteria**
  - Icon/color shown in the switcher avatar, project-menu rows, and project list
  - Or: drop the pickers if the icon/color aren't wanted

---

- [ ] **UX-2 — Keyboard-accessible project switcher**

  Menu rows are `<div onClick>` with no `role`/`tabIndex`/key handlers; the trigger lacks
  `aria-expanded`/`aria-haspopup`; dropdowns don't close on `Escape`.

  **Files:** `frontend/src/App.jsx` · the project switcher dropdown

  **Config/schema impact:** None.

  **Acceptance criteria**
  - Rows are buttons (or `role="menuitem"` + Enter/Space activation)
  - Trigger exposes `aria-expanded`/`aria-haspopup`; `role="menu"` + Escape-to-close
  - Matches the existing `Modal` focus/Escape behavior

### Medium

---

- [ ] **UX-3 — Archived rows look clickable but do nothing**

  Archived project rows reuse active-row styling (hover highlight) but have no row `onClick` —
  only the gear works.

  **Files:** the project switcher / project list

  **Config/schema impact:** None.

  **Acceptance criteria**
  - Archived rows have an explicit Unarchive affordance / row action
  - Visually de-emphasized so they don't read as switchable

---

- [ ] **UX-4 — Unsaved-changes guard on the project form**

  [frontend/src/pages/ProjectForm.jsx](../frontend/src/pages/ProjectForm.jsx) has no dirty
  tracking; editing Details then hitting ← Back discards silently.

  **Files:** `frontend/src/pages/ProjectForm.jsx`

  **Config/schema impact:** None.

  **Acceptance criteria**
  - Wired into the existing `dirtyRef`/`DirtyProvider` guard used for project switching
  - Back/navigate-away with unsaved edits prompts to confirm

---

- [ ] **UX-5 — Member rows fall back to a raw UUID**

  [frontend/src/components/ProjectMembersPanel.jsx](../frontend/src/components/ProjectMembersPanel.jsx)
  renders `m.email || m.name || m.user_id`, so members without email/name show a UUID.

  **Files:** `frontend/src/components/ProjectMembersPanel.jsx` + the members endpoint

  **Config/schema impact:** None — populate email/name server-side.

  **Acceptance criteria**
  - Members show email/name, never a UUID
  - A "you" tag marks the current user

### Low / polish

---

- [ ] **UX-6 — Inline validation for required name (ProjectForm)**

  Currently a toast only. Add an inline error + disable submit until valid.

  **Files:** `frontend/src/pages/ProjectForm.jsx` · **Impact:** None.

---

- [ ] **UX-7 — Explain read-only email (ProfileForm)**

  Add "Managed by your sign-in provider" helper text so the disabled field doesn't look broken.

  **Files:** ProfileForm · **Impact:** None.

---

- [ ] **UX-8 — Accessible labels on color swatches / icon buttons**

  They convey meaning by color/emoji alone; add `aria-label` + `aria-pressed` on the selected one.

  **Files:** `frontend/src/pages/ProjectForm.jsx` · **Impact:** None.

---

- [ ] **UX-9 — Global "switching…" feedback**

  A brief unified indicator while a project switch hydrates (minor now that `pull_workspace`
  is parallelized).

  **Files:** `frontend/src/App.jsx` · **Impact:** None.

---

## M&E capabilities

> Still-open gaps from the 2026-04-07 M&E audit. The audit's top findings have **shipped** —
> see *Shipped foundations* above. The full original audit + scorecard is archived at
> [docs/archive/2026-04-07-me-audit.md](archive/2026-04-07-me-audit.md). What remains:

---

- [ ] **ME-1 — Equity / inclusion lens**

  Indicators support `disaggregate_by`, but there's no automatic cross-group comparison that
  *surfaces* inequities (gaps, convergence, exclusion) — let alone significance.

  **Files:** `src/reports/indicators.py` · chart engine · `sample.config.yml`

  **Config/schema impact:** New optional `equity_dimensions` config section.

  **Acceptance criteria**
  - `equity_dimensions:` lists cross-cutting variables (gender, age_group, location)
  - `build-report` auto-generates one disaggregation block (stacked/grouped bar) per
    indicator × dimension
  - One config line → a full disaggregation section in the report

---

- [ ] **ME-2 — Variance / traffic-light dashboards**

  `pct_achievement` is computed per indicator and per framework node, but nothing flags
  indicators below threshold or renders a red/amber/green progress table.

  **Files:** `src/reports/indicators.py` · template + `src/reports/builder.py`

  **Config/schema impact:** Per-indicator threshold fields.

  **Acceptance criteria**
  - Indicators accept warning/critical thresholds
  - A traffic-light progress table renders (Indicator | Baseline | Target | Actual | %)
  - Below-threshold indicators are flagged in the report + Validate panel

---

- [ ] **ME-3 — Indicator metadata catalog**

  Indicators carry computation params + `direction`, but not `unit`, `source`, `frequency`,
  or `responsible`, so the donor-style indicator reference annex can't be auto-generated.

  **Files:** `src/reports/indicators.py` · `src/reports/template_generator.py`

  **Config/schema impact:** New indicator fields (`unit`, `source`, `frequency`, `responsible`).

  **Acceptance criteria**
  - Indicators accept the metadata fields (all optional)
  - `generate-template` emits an indicator reference annex from them

---

- [ ] **ME-4 — Multi-form / longitudinal linkage**

  The platform connects to exactly one form. Many frameworks need baseline ↔ endline (matched
  on beneficiary ID), monitoring ↔ registration, activity ↔ outcome. Largest change here.

  **Files:** `api:` config · `src/data/extract.py` · `src/data/make.py` · indicators/charts

  **Config/schema impact:** `api:` lists multiple aliased forms.

  **Acceptance criteria**
  - `fetch-questions` + `download` produce named DataFrames per form alias
  - Indicators/charts can reference `form: baseline` vs `form: endline`
  - Enables pre/post and difference-in-differences

---

- [ ] **ME-5 — Sampling weights**

  No support for survey weights — all aggregates assume equal weighting. (`--sample N` is for
  testing only, not statistical sampling.)

  **Files:** `src/reports/indicators.py` · `src/reports/charts.py`

  **Config/schema impact:** New `weight_column` option on charts + indicators.

  **Acceptance criteria**
  - When `weight_column` is set, aggregate with `numpy.average(weights=…)` instead of simple means
  - No data-pipeline change — weighted computation only
  - Unweighted behavior unchanged when the option is absent

---

## Backlog — parked (out of scope for now)

> Captured so they aren't lost; not scheduled. Promote into a domain section above when picked up.

- **Skip the download when the remote is unchanged** — `run-all` already skips a stale
  build-report; skipping the *download* itself when the Kobo/Ona remote hasn't changed is a
  later slice (would need a remote content fingerprint).
- **True multi-user read isolation** — concurrent users with different active projects share
  the one `BASE_DIR` read-mirror (best-effort, last-writer-wins). Durable Minio/DB data is
  always correct; per-user read isolation is out of scope (see `CLAUDE.md` → run concurrency).
