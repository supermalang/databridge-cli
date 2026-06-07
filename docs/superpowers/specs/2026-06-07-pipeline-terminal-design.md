# Pipeline-mirrored, persistent terminal

**Date:** 2026-06-07
**Scope:** `frontend/src/components/BottomTerminal.jsx`, `frontend/src/App.jsx`, minor `frontend/src/styles.css`

## Goal

Make the bottom terminal mirror the app's pipeline, persist its log across
navigation and reloads, and let the user filter the log by pipeline stage and by
log level. Remove cosmetic clutter (clear/split/settings buttons, ttyd shell).

## Requirements

1. **Sidebar mirrors the real pipeline.** Replace the stale `PIPELINE_TREE` with a
   `Pipeline` parent over the five canonical stages used by the nav
   (`App.jsx` STAGES / `Home.jsx` STAGE_CARDS): Extract, Transform, Model,
   Analyze, Deliver. All five are shown even though Model/Analyze have no
   `/api/run` commands today — they mirror the workflow and show an empty state.

2. **Stage filtering.** Each log line is attributed to a stage via a single
   `COMMAND_STAGE` map keyed by the run command:

   | Command | Stage |
   |---|---|
   | `download` | extract |
   | `fetch-questions` | transform |
   | `generate-template`, `build-report` | present (Deliver) |
   | `run-all` / unmapped | Pipeline only |

   Clicking a stage filters the log to lines from that stage's commands;
   `Pipeline` (parent) shows everything. The map lives in `BottomTerminal.jsx`;
   lines only carry their `command`, and the component derives the stage.

3. **Persistence (accumulate + localStorage, per project).**
   - App tracks the currently-running command in a ref; every log line is tagged
     with that command.
   - New runs **append** instead of wiping. The `setLogLines([])` on run start is
     removed and replaced with a `▶ running <cmd>` separator line.
   - The buffer is mirrored to `localStorage` under
     `databridge:termlog:<projectId>`, debounced (~500ms) and capped to the last
     ~1500 lines. On project switch / reload it rehydrates that project's log.

4. **Removals.**
   - Remove the clear / split / settings buttons — keep only the open/close
     toggle. (No clear button survives; logs persist instead.)
   - Remove the `shell (ttyd)` session, its iframe, and the `· ttyd` label in the
     bar.

5. **Level filters (kept).** The info/ok/warn/error checkboxes stay and combine
   with the stage filter (stage AND level).

## Non-goals

- Splitting `run-all` output into per-stage lines (its SSE command stays
  `run-all`; it lives under Pipeline).
- Server-side log storage. Persistence is browser-local only.
