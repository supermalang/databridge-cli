---
name: refactor
description: Behavior-preserving structural cleanup. Green baseline → name one smell → refactor incrementally → verify green after each step. Never changes behavior, never edits tests, never adds features.
---

# /refactor — Behavior-Preserving Cleanup (databridge-cli)

Improves code structure without changing behaviour. Tests are the safety net.

## Preconditions

```bash
PYTHONPATH=. MPLBACKEND=Agg python -m pytest -q
```

Must be green before starting. Red suite → STOP, escalate to `/debugger`.

Untested code → STOP, get characterisation tests from `/test-writer` first.

## Workflow

### 1 — Name the smell

Write it out before touching a file. One smell per refactor session:

- "Duplicated chart-option parsing in `charts.py` (4 identical blocks)"
- "`builder.py:fill_template()` is 180 lines doing 6 different things"
- "Magic number `1024` appears 8 times in `flatten.py` with no name"
- "Variable `d` is used for both `data` and `date` in `transform.py`"

### 2 — Plan the moves

Name the target state: "Extract to `_parse_chart_opts(opts)` called from each chart fn."
Identify all call sites. Confirm no public API change.

### 3 — Refactor incrementally

Small steps:
1. Extract function / constant / class
2. `PYTHONPATH=. MPLBACKEND=Agg python -m pytest -q` — green?
3. Replace one call site
4. Test again
5. Repeat for remaining sites

Never batch more than one logical move without a test run in between.

### 4 — Hold the line

If you discover a bug while refactoring: note it, do NOT fix it here. Hand it to `/debugger`.
If you discover a feature gap: note it, do NOT implement it. Hand it to the roadmap.
If any test turns red mid-refactor: revert the last step, reassess.

### 5 — Verify and report

```bash
PYTHONPATH=. MPLBACKEND=Agg python -m pytest -q   # full suite
cd frontend && npm run lint                          # if JSX changed
```

Report: smell → target → files changed → test result before/after → confirmation of no
behaviour change (public signatures and return values unchanged).

## Common smells in this codebase

| File | Common smell | Refactor |
|---|---|---|
| `src/reports/charts.py` | Repeated `opts.get(...)` blocks per chart | Extract `_parse_opts(opts, defaults)` |
| `src/data/make.py` | Long command functions with mixed concerns | Extract sub-steps into private helpers |
| `src/data/flatten.py` | Magic column name strings | Named constants at module top |
| `web/main.py` | Repeated `_active_project(...)` boilerplate | Dependency-injection helper already exists — use it |
| `frontend/src/pages/` | Inline JSX repeated across tabs | Extract to `components/` |
