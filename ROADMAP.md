# Roadmap

Planned work, grouped by area. Items here are intentionally *not* enabled in the
UI yet — they render as disabled "soon" affordances so users know they're coming.

## Output / export formats

The **Deliver → Output** tab ships **CSV** and **XLSX** data-file exports today
(`export.format`). The following targets are designed in the config schema and
have CLI/back-end support, but are gated off in the UI until verified
end-to-end per project:

- [ ] **JSON** — records array
- [ ] **MySQL** — remote table export (credentials in `export.database`)
- [ ] **PostgreSQL** — remote table export

When re-enabling a format, drop its `soon: true` flag in `FORMATS`
([frontend/src/pages/Sources.jsx](frontend/src/pages/Sources.jsx)) and confirm
the matching `_export_*` path in [src/data/transform.py](src/data/transform.py).

## UX — Project management & top ribbon

Findings from a UX audit of the project switcher / create-edit form / profile /
members flow (shipped in #63). Grouped by impact.

### High

- [ ] **Show project color & icon.** The create/edit form collects a color + emoji
  icon, but they're rendered nowhere — the switcher avatar
  ([frontend/src/App.jsx](frontend/src/App.jsx)) still shows `name.slice(0,2)` and
  the menu rows are text-only. Surface the icon/color in the switcher avatar, the
  project-menu rows, and the project list (or drop the pickers).
- [ ] **Keyboard-accessible project switcher.** Menu rows are `<div onClick>` with no
  `role`/`tabIndex`/key handlers, the trigger lacks `aria-expanded`/`aria-haspopup`,
  and the dropdowns don't close on `Escape`. Convert rows to buttons (or
  `role="menuitem"` + Enter/Space), add `role="menu"` + Escape-to-close, matching the
  `Modal` focus/Escape behavior.

### Medium

- [ ] **Archived rows look clickable but do nothing.** Archived project rows reuse the
  active-row styling (hover highlight) but have no row `onClick` — only the gear works.
  Give them an explicit Unarchive affordance / row action and visually de-emphasize so
  they don't read as switchable.
- [ ] **Unsaved-changes guard on the project form.**
  [frontend/src/pages/ProjectForm.jsx](frontend/src/pages/ProjectForm.jsx) has no dirty
  tracking; editing Details then hitting ← Back discards silently. Wire it into the
  existing `dirtyRef`/`DirtyProvider` guard already used for project switching.
- [ ] **Member rows fall back to a raw UUID.**
  [frontend/src/components/ProjectMembersPanel.jsx](frontend/src/components/ProjectMembersPanel.jsx)
  renders `m.email || m.name || m.user_id`, so members without email/name show a UUID.
  Populate email/name server-side and use a friendlier fallback (+ a "you" tag for self).

### Low / polish

- [ ] **Inline validation for required name** (ProjectForm) — currently a toast only;
  add an inline error + disable submit until valid.
- [ ] **Explain read-only email** (ProfileForm) — add "Managed by your sign-in provider"
  helper text so the disabled field doesn't look broken.
- [ ] **Accessible labels on color swatches / icon buttons** — they convey meaning by
  color/emoji alone; add `aria-label` + `aria-pressed` on the selected one.
- [ ] **Global "switching…" feedback** — a brief unified indicator while a project
  switch hydrates (minor now that `pull_workspace` is parallelized).
