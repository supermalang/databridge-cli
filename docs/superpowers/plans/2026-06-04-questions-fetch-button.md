# Fetch-from-Kobo Button in the Questions Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repurpose the Questions tab's "Refresh from form" button so it runs the real `fetch-questions` command (Kobo/Ona API → `config.yml`), streaming logs to the shared BottomTerminal and reloading the question list on completion.

**Architecture:** A tiny React context (`RunProvider`/`useRun`) exposes the single `useCommand` instance that already lives in `App.jsx` (its `run`/`running`/`activeCmd`) to any tab — mirroring the existing `PermsProvider` pattern. `Questions.jsx` consumes `useRun()` + `usePerms()` and points both "Refresh from form" button sites at a `fetchFromForm` handler that awaits the run, then reloads. No backend changes.

**Tech Stack:** React 18 (functional components + context), Vite. No JS test framework exists in this repo, so each task is verified with `npm run build` (catches syntax/import/JSX errors) plus a final manual smoke test.

**Base branch:** `worktree-questions-fetch-button`, rebased onto `ui-terminal-and-prompt-fixes` (which has the App-level `useCommand`, shared `BottomTerminal`, and `perms.js`).

---

## File Structure

- **Create** `frontend/src/lib/run.js` — `RunContext` + `RunProvider` + `useRun()` hook. One responsibility: share the run plumbing.
- **Modify** `frontend/src/App.jsx` — import `RunProvider`, wrap the panes with `<RunProvider value={{ run, running, activeCmd }}>` inside the existing `PermsProvider`.
- **Modify** `frontend/src/pages/Questions.jsx` — consume `useRun()` + `usePerms()`, add `fetchFromForm`, repoint both `Header` sites and update the `Header` component signature + button label.

---

### Task 1: Create the `RunProvider` / `useRun` context

**Files:**
- Create: `frontend/src/lib/run.js`

- [ ] **Step 1: Write `run.js`**

```jsx
// Shares the single useCommand instance from App (its run + running + activeCmd) with
// any tab that needs to trigger a pipeline command and stream into the shared
// BottomTerminal. Mirrors the PermsProvider pattern in lib/perms.js.
import { createContext, useContext } from 'react';

const RunContext = createContext({
  run: async () => {},
  running: false,
  activeCmd: null,
});

export const RunProvider = RunContext.Provider;

export function useRun() {
  return useContext(RunContext);
}
```

- [ ] **Step 2: Verify the build still passes**

Run: `cd frontend && npm run build`
Expected: build succeeds (the new file is not imported yet, so this just confirms no syntax error).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/run.js
git commit -m "feat(ui): RunProvider/useRun context to share the run plumbing"
```

---

### Task 2: Wrap the panes with `RunProvider` in `App.jsx`

**Files:**
- Modify: `frontend/src/App.jsx` (import near line 20; wrap panes at lines 301–318)

- [ ] **Step 1: Add the import**

Find the perms import (around line 20):

```jsx
import { PermsProvider } from './lib/perms.js';
```

Add immediately after it:

```jsx
import { RunProvider } from './lib/run.js';
```

- [ ] **Step 2: Wrap the panes container with `RunProvider`**

Find this block (around lines 301–318):

```jsx
      <PermsProvider value={{ role: activeRole, isSuperadmin }}>
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, minHeight: 0 }}>
          {panes
            .filter(p => visited.has(p.key) || p.key === activeKey)
            .map(p => (
              <div
                key={`${p.key}#${keyEpoch[p.key] ?? epoch}`}
                className="tab-content"
                style={{
                  flex: 1, minHeight: 0, overflow: 'auto', flexDirection: 'column',
                  display: p.key === activeKey ? 'flex' : 'none',
                }}
              >
                {p.render()}
              </div>
            ))}
        </div>
      </PermsProvider>
```

Replace it with (adds the `RunProvider` wrapper just inside `PermsProvider`):

```jsx
      <PermsProvider value={{ role: activeRole, isSuperadmin }}>
        <RunProvider value={{ run, running, activeCmd }}>
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, minHeight: 0 }}>
            {panes
              .filter(p => visited.has(p.key) || p.key === activeKey)
              .map(p => (
                <div
                  key={`${p.key}#${keyEpoch[p.key] ?? epoch}`}
                  className="tab-content"
                  style={{
                    flex: 1, minHeight: 0, overflow: 'auto', flexDirection: 'column',
                    display: p.key === activeKey ? 'flex' : 'none',
                  }}
                >
                  {p.render()}
                </div>
              ))}
          </div>
        </RunProvider>
      </PermsProvider>
```

(`run`, `running`, `activeCmd` already exist in this component — destructured from `useCommand` around line 137.)

- [ ] **Step 3: Verify the build passes**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(ui): provide run plumbing to all tabs via RunProvider"
```

---

### Task 3: Wire the fetch button in `Questions.jsx`

**Files:**
- Modify: `frontend/src/pages/Questions.jsx` (imports; component body; both `Header` call sites at ~line 272 and ~288; `Header` component at ~line 344; empty-state copy at ~line 273)

- [ ] **Step 1: Add imports**

After the existing import of `loadConfig` (around line 3), add:

```jsx
import { useRun } from '../lib/run.js';
import { usePerms } from '../lib/perms.js';
```

- [ ] **Step 2: Consume the contexts + add the handler**

Inside `export default function Questions() {`, just after `const toast = useToast();` (line 31), add:

```jsx
  const { run, running, activeCmd } = useRun();
  const { canEdit } = usePerms();
```

Then, immediately after the `load` definition's closing `}, [toast]);` (around line 50), add the handler:

```jsx
  // Run the real fetch-questions command (Kobo/Ona API → config.yml), streaming logs
  // to the shared BottomTerminal. `run` resolves when the SSE stream finishes, so we
  // reload the (possibly rewritten) question list afterward regardless of outcome.
  const fetchFromForm = useCallback(async () => {
    await run('fetch-questions');
    await load();
  }, [run, load]);
```

(`useCallback` is already imported on line 1.)

- [ ] **Step 3: Update the empty-state `Header` call + copy**

Find (around lines 270–276):

```jsx
      <div className="page">
        <Header total={0} groups={0} unsaved={0} onRefresh={load} onSave={save} />
        <div className="src-card"><p className="empty-state">No questions yet — run <b>fetch-questions</b> from the Dashboard.</p></div>
      </div>
```

Replace with:

```jsx
      <div className="page">
        <Header
          total={0}
          groups={0}
          unsaved={0}
          onFetch={fetchFromForm}
          onSave={save}
          fetching={running && activeCmd === 'fetch-questions'}
          busy={running}
          canEdit={canEdit}
        />
        <div className="src-card"><p className="empty-state">No questions yet — click <b>Fetch from form</b> above to pull the schema from your platform.</p></div>
      </div>
```

- [ ] **Step 4: Update the populated-state `Header` call**

Find (around lines 288–294):

```jsx
      <Header
        total={questions.length}
        groups={totalGroups}
        unsaved={dirtyIndices.size}
        onRefresh={load}
        onSave={save}
      />
```

Replace with:

```jsx
      <Header
        total={questions.length}
        groups={totalGroups}
        unsaved={dirtyIndices.size}
        onFetch={fetchFromForm}
        onSave={save}
        fetching={running && activeCmd === 'fetch-questions'}
        busy={running}
        canEdit={canEdit}
      />
```

- [ ] **Step 5: Update the `Header` component**

Find the whole `Header` function (around lines 344–366):

```jsx
function Header({ total, groups, unsaved, onRefresh, onSave }) {
  return (
    <PageHeader
      eyebrow={`Questions · ${total} fields · ${groups} groups`}
      title="Rename what shows up"
      accent="in the report."
      sub="Each row is a survey question. Edit the Export label to change how that column appears in charts, indicators, and Word placeholders — no YAML required."
      actions={
        <>
          {unsaved > 0 && <span className="q-unsaved-pill">{unsaved} unsaved</span>}
          <button className="btn" onClick={onRefresh}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><polyline points="2 4 2 8 6 8"/><path d="M3 11a6 6 0 1 0 1.4-7"/></svg>
            Refresh from form
          </button>
          <button className="btn btn-primary" onClick={onSave} disabled={unsaved === 0}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 8 7 12 13 4"/></svg>
            Save changes
          </button>
        </>
      }
    />
  );
}
```

Replace with (renames `onRefresh`→`onFetch`, adds `fetching`/`busy`/`canEdit`, hides the button for non-editors, disables + relabels while a run is active):

```jsx
function Header({ total, groups, unsaved, onFetch, onSave, fetching, busy, canEdit }) {
  return (
    <PageHeader
      eyebrow={`Questions · ${total} fields · ${groups} groups`}
      title="Rename what shows up"
      accent="in the report."
      sub="Each row is a survey question. Edit the Export label to change how that column appears in charts, indicators, and Word placeholders — no YAML required."
      actions={
        <>
          {unsaved > 0 && <span className="q-unsaved-pill">{unsaved} unsaved</span>}
          {canEdit && (
            <button className="btn" onClick={onFetch} disabled={busy} title="Fetch the latest form schema from your Kobo/Ona platform (preserves your renames and hidden/PII flags)">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><polyline points="2 4 2 8 6 8"/><path d="M3 11a6 6 0 1 0 1.4-7"/></svg>
              {fetching ? 'Fetching…' : 'Fetch from form'}
            </button>
          )}
          <button className="btn btn-primary" onClick={onSave} disabled={unsaved === 0}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 8 7 12 13 4"/></svg>
            Save changes
          </button>
        </>
      }
    />
  );
}
```

- [ ] **Step 6: Verify the build passes**

Run: `cd frontend && npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/Questions.jsx
git commit -m "feat(questions): Fetch-from-form button runs fetch-questions"
```

---

### Task 4: Manual verification

**No automated UI tests exist in this repo**, so confirm behavior by running the app.

- [ ] **Step 1: Start the dev servers**

Run: `./scripts/dev.sh`
Open the forwarded Vite port, go to **Transform → Questions**.

- [ ] **Step 2: Confirm the fetch flow**

- Click **Fetch from form**.
- Expected: the BottomTerminal opens and streams `fetch-questions` logs; the button shows **Fetching…** and is disabled while it runs; a success toast appears; the question list reloads when it finishes.

- [ ] **Step 3: Confirm gating + busy state**

- While a run is active (e.g. start a pipeline run from Home), the button is disabled.
- As a viewer-role user (or by temporarily forcing `canEdit` false), the button is hidden.

- [ ] **Step 4: Confirm the empty state**

- With no questions configured, the empty-state card shows the updated copy and the **Fetch from form** button is present (for editors) and works.

---

## Self-Review

**Spec coverage:**
- "Thread `run` into Questions via a small `RunContext`" → Tasks 1–2. ✓
- "Questions tab changes: consume `useRun`/`usePerms`, `fetchFromForm`, repoint both button sites, disable while running, hide for non-editors" → Task 3. ✓
- "Empty-state copy updated" → Task 3 Step 3. ✓
- "Backend — no changes" → no backend task. ✓
- "Testing/verification: `npm run build` + manual" → build step in every task + Task 4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type/name consistency:** `Header` props renamed consistently across both call sites (Task 3 Steps 3–4) and the component definition (Step 5): `onFetch`, `fetching`, `busy`, `canEdit`. `useRun()` returns `{ run, running, activeCmd }` (Task 1) exactly as consumed in Task 3 Step 2. `fetchFromForm` defined once and referenced by both `Header` sites. ✓
