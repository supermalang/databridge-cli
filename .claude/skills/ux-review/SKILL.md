---
name: ux-review
description: Structural UX auditor across 7 dimensions. Report-only in ship-task; may apply appearance fixes in manual mode. Complements /impeccable.
---

# /ux-review — Structural UX Auditor (databridge-cli)

Audits UI changes for structural correctness across 7 dimensions. Complements `/impeccable`
(which handles deeper design system work and can polish/redesign). Use this for pipeline
quality gates; use `/impeccable` for full design iteration.

## 7 dimensions checklist

### 1 — Language
- Plain English, field-literacy-aware (M&E officers, mixed technical skill)
- No unexplained jargon (no "API", "JSON", "payload" in user-facing copy)
- Consistent with adjacent screens (same verb for same action)
- Error messages: what happened + what to do

### 2 — Badges / status chips
- Severity colours consistent: success `#0F766E` · warning amber · error red
- Pill shape matches existing chips in `frontend/src/styles.css`
- Never use teal for non-action elements

### 3 — Icons
- From the established icon set (check existing components for precedents)
- Paired with a visible label (or `aria-label`) — never icon-only for actions
- Correct optical size (16px inline, 20px standalone)

### 4 — Layout
- Grid alignment: uses CSS grid/flex from `styles.css`, not ad-hoc margins
- Spacing: uses CSS custom properties (`--space-*`), not hardcoded px
- No orphaned elements (single items in a row that should be in a group)

### 5 — Components
- Reuses existing components from `frontend/src/components/`
- New one-off components extracted and named, not inlined in page JSX
- No duplicated markup that already exists elsewhere

### 6 — Accessibility (WCAG 2.1 AA)
- Contrast ≥ 4.5:1 for text, ≥ 3:1 for large text / UI components
- All interactive elements reachable by keyboard (Tab order logical)
- Focus ring visible (not `outline: none` without a custom ring)
- Form inputs have associated `<label>` (not just placeholder)
- Dynamic content updates announced (`aria-live` where needed)

### 7 — Consistency
- Visual language matches the six-tab dashboard (same tab chrome, same card style)
- Mono font (`JetBrains Mono`) used ONLY for machine-literal values (IDs, paths, code)
- Teal used ONLY for primary actions — never decoration

## Design tokens (from DESIGN.md)

```
Accent:     #0F766E (Deep Field Teal)
Background: #F8FAFC
Surface:    #FFFFFF
Text:       #0F172A / muted #64748B
Border:     1px solid #E2E8F0
Font body:  Inter
Font mono:  JetBrains Mono (machine-truth only)
```

## Mode

**Report-only** (ship-task dispatch):
Return structured `blockers` (Critical deviations) and `warnings` (Minor), no edits.

**Fix mode** (manual invocation with a specific path):
May edit `frontend/src/` for appearance-only changes — CSS, copy, icon refs, ARIA.
Never touch business logic, state, API calls, or tests.

## Output format

```
ux-review CLEAR / BLOCKED

Blockers:
- <file:line> · <dimension> · <issue> · <fix>

Warnings:
- <file:line> · <dimension> · <issue> · <fix>
```
