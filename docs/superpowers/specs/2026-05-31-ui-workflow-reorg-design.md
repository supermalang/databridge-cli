# UI Workflow Reorganization — Design

**Date:** 2026-05-31
**Status:** Approved direction; executing autonomously.

## Goal

Four related UI changes that reorganize the app around the data-analysis workflow:

1. **Questions tab** — group questions by root group → nested subgroups (today it's flat per full slash-path).
2. **Hidden questions** — notes/labels/instructions/comments are hidden by default across Questions, Profile, and Validate tabs, tucked into a collapsed "Hidden (N)" sub-accordion per group, with an unhide toggle. Detection is deterministic (`type == "note"`) + manual override; plus an explicit (never automatic) LLM-assist "Suggest fields to hide" button.
3. **Profile tab** — same nested-group + hidden treatment.
4. **Home** — rename Dashboard→Home; restructure the horizontal nav into 5 workflow stages with sub-menu items; Home shows just the 5 ordered stage cards + the run-pipeline control.

## Decisions (confirmed with user)

- **Hidden detection:** deterministic `type == "note"` default + manual per-question toggle, persisted in `config.yml`. **Plus** an explicit LLM-assist button. No automatic LLM classification.
- **Nav:** actually restructure into the 5 stages (not just an overlay), adding sub-menu items where a stage holds multiple pages. This splits the Composition tab.
- **Home:** minimal — 5 stage cards + run-pipeline control only. Drop the mock KPI/runs/AI-queue/usage widgets.

## The 5 workflow stages → existing pages

| Stage | Pages (sub-tabs) |
|---|---|
| **1 · Extract** | Sources |
| **2 · Transform** | Questions, Validate, Profile |
| **3 · Load** | Views (split out of Composition) |
| **4 · Analyze** | Charts/Indicators/Summaries/Framework (rest of Composition), Ask |
| **5 · Present** | Reports, Templates |

PII card: kept under Analyze for now (render-time redaction). Filters: state exists in Composition but no card is currently rendered — left as-is.

## Architecture

### Backend
- `src/data/questions.py`: `_make_question` adds `"hidden": (q_type == "note")`. `fetch_and_write_questions` preserves a prior explicit `hidden` on re-fetch (same pattern as `category`/`export_label`). `QuestionsPayload.questions: list` already round-trips arbitrary keys, so the web save path needs no change.
- `POST /api/questions/suggest-hidden`: synchronous endpoint. Builds a compact catalog of questions (kobo_key, label, type, category), asks the configured AI provider (via existing `lf_client`/seed-prompt plumbing) which are non-analytical (instructions/labels/acknowledgments). Returns `{suggestions: [kobo_key,...], reasons: {kobo_key: why}}`. No-AI → graceful `{suggestions: [], message}`.

### Frontend shared infra
- `frontend/src/lib/questionGroups.js` — pure helpers:
  - `isHidden(q)` → `q.hidden ?? (q.type === 'note')`
  - `buildGroupTree(items, { getPath, getHidden })` → nested tree: each node `{ name, path, depth, visible: [items], hidden: [items], children: [nodes] }`, built from slash-delimited paths. Root bucket name `"— no group —"` for empty paths.
  - `indexQuestionsByColumn(questions)` → `Map(export_label|label|bareName → q)` so Profile/Validate can map a data column back to its group + hidden flag. Columns with no match go to an "Ungrouped" bucket.
- `frontend/src/components/GroupTree.jsx` — recursive accordion. Props: `tree`, `renderVisible(items, node)`, `renderHidden(items, node)` (optional), `defaultOpenDepth`. Manages open/closed state internally (Set of paths). Each node renders a header (name · count · breakdown slot) and, when it has hidden items, a nested collapsed "Hidden (N)" sub-accordion.
- CSS in `styles.css`: nested group tree + hidden sub-accordion (reuses `.q-group*` tokens).

### Frontend pages
- **Questions**: replace flat `byGroup` with `buildGroupTree`; render via `GroupTree`. Add a per-row hide/unhide toggle (sets explicit `q.hidden`). Add an "✨ Suggest fields to hide" button calling the new endpoint, which flags returned keys as `hidden` in memory (user reviews + Saves).
- **Profile**: per table, join columns→questions via `indexQuestionsByColumn`, then `buildGroupTree` over columns; hidden columns in the collapsed sub-section. Linkage cols stay filtered out; unmatched cols → "Ungrouped".
- **Validate**: group findings by their column's question group via the same join; hidden-column findings in the collapsed sub-section.

### Nav + Home
- `App.jsx`: replace flat `TABS` with a `STAGES` structure (stage → sub-tabs). Two-level nav: top stage bar + secondary sub-tab strip when a stage has >1 page. Active state tracks `{stage, sub}`.
- `Home.jsx` (renamed/trimmed Dashboard): 5 ordered stage cards (each links to its first sub-tab) + the run-pipeline control + bottom terminal for run logs. Mock widgets removed.
- Composition gets a `sections` prop; Load and Analyze routes mount it with different section sets, and `saveAll` only writes the keys for the rendered sections.

## Out of scope / deferred (report these)
- Deep refactor of Composition into truly separate page components (using `sections` prop instead).
- Backend `group` in the `/api/profile` payload (doing the join client-side instead).
- Migrating existing `config.yml` files (handled by the `hidden ?? type==note` fallback).
