# Fetch-from-Kobo button in the Questions tab

**Date:** 2026-06-04
**Branch:** `worktree-questions-fetch-button`

## Problem

The Questions tab (`frontend/src/pages/Questions.jsx`) has a button labelled
**"Refresh from form"**, but it is misleading: `onRefresh={load}` only re-reads the
local config via `GET /api/questions`. It never contacts the Kobo/Ona API.

The command that actually fetches the live form schema and rewrites `config.yml`
is `fetch-questions`. Today it can only be triggered from the Home/Dashboard, via
the `run` helper from `useCommand` (which streams logs into the shared
BottomTerminal). A user editing questions has no way to pull a fresh schema from
the place where it matters.

## Goal

Repurpose the Questions tab's "Refresh from form" button so it runs the real
`fetch-questions` command against the Kobo/Ona API, streams logs to the shared
BottomTerminal, and reloads the question list when the run completes.

## Decisions (from brainstorming)

- **Replace, don't add:** the existing "Refresh from form" button is repurposed to
  run `fetch-questions`. We do not keep a separate "reload local config only"
  button. The page already reloads on mount, on the hourly/`data-changed` epoch
  bump, and the fetch handler reloads explicitly on completion — so a dedicated
  local-reload affordance is unnecessary.
- **Stream to BottomTerminal:** reuse the existing `useCommand`/SSE plumbing so logs
  appear in the sticky bottom terminal, consistent with the Dashboard's run UX.

## Design

### 1. Thread `run` into Questions via a small `RunContext`

`run` (and `running` / `activeCmd`) come from the single `useCommand` instance
inside `App.jsx`. Today they are only passed to `Home`; the other tabs render from
the module-level `STAGES` array, which cannot capture component-scope values.

Add a lightweight React context, mirroring the existing `PermsProvider` pattern:

- New file `frontend/src/lib/run.js` exporting `RunProvider` and a `useRun()` hook
  (returns `{ run, running, activeCmd }`).
- In `App.jsx`, wrap the panes (inside or alongside the existing `PermsProvider`)
  with `<RunProvider value={{ run, running, activeCmd }}>`.

This avoids prop-drilling through the static `STAGES` array and lets any future tab
trigger a run into the same terminal. Because there is still exactly one shared
`useCommand` instance, its single-flight guard (`if (running) return;`) continues
to prevent concurrent runs from clobbering `config.yml` / `data/`.

### 2. Questions tab changes (`Questions.jsx`)

- Consume `useRun()` for `{ run, running, activeCmd }` and `usePerms()` for
  `canEdit`.
- Add a handler, e.g.:
  ```js
  const fetchFromForm = async () => {
    await run('fetch-questions');  // resolves when the SSE stream finishes
    await load();                  // reload the (possibly rewritten) question list
  };
  ```
  `run` resolves after the stream completes (success or failure), so the list is
  reloaded either way; `load()` is idempotent and harmless on failure. App's
  existing `onStatus`/`onLog` callbacks already open the terminal, stream lines,
  and toast success/failure — no extra feedback wiring needed here.
- Repurpose **both** button sites to call `fetchFromForm` instead of `load`:
  1. The populated-state `Header` component's "Refresh from form" button.
  2. The empty-state header (the `questions.length === 0` branch), whose copy
     ("run **fetch-questions** from the Dashboard") is updated since the action is
     now available directly on this tab.
- Button state:
  - Disabled while a run is active (`running`), with label/spinner showing
    "Fetching…" when `activeCmd === 'fetch-questions'`.
  - Hidden or disabled for non-editors (`!canEdit`) — the server already
    editor-gates the command, this is the matching client affordance.

### 3. Backend — no changes

`fetch-questions` is already:
- whitelisted in `ALLOWED_COMMANDS` (`web/main.py`),
- editor-role gated,
- executed in the isolated per-run temp-dir workspace, with `config.yml` synced
  back to the DB and the `BASE_DIR` mirror refreshed on success.

So `GET /api/questions` after the run returns the freshly-fetched schema.

## Out of scope

- No new backend endpoints or command flags.
- No change to `fetch-questions` behavior itself.
- No fetch buttons on other tabs (the `RunContext` makes that easy later, but it is
  not part of this change).
- No confirmation dialog before fetching (fetch-questions preserves user edits to
  `category`/`export_label` per `kobo_key`, so re-fetch is non-destructive).

## Testing / verification

There is no JS test suite in this repo. Verification is:
1. `cd frontend && npm run build` succeeds (no syntax/import errors).
2. Manual: from the Questions tab, the button triggers a `fetch-questions` run,
   logs stream to the BottomTerminal, and the list reloads on completion.
3. Manual: button is disabled while running and for viewer-role users.
