---
name: debugger
description: Root-cause bug fixer for the Python/FastAPI/React codebase. Reproduce → isolate → minimal fix → verify green. Never patches symptoms or edits tests.
---

# /debugger — Root-Cause Bug Fixer (databridge-cli)

## When to use

- `Type: Fix` task dispatched by ship-task
- Self-repair loop: tests still red after implementer attempts
- Ad-hoc: a bug reported outside the roadmap pipeline

## Workflow

### 1 — Reproduce

Run the failing test(s) exactly as written. Confirm the failure message makes sense.

```bash
PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/<file>::<test> -v
# or for frontend
cd frontend && npm run test:e2e -- --headed --grep "<test name>"
```

If the test errors (not fails), it may be a fixture/import problem — report to the test author.

### 2 — Isolate (read before guessing)

Trace the call path from the failing assertion back to the source:

```bash
# Find where the symbol is defined
grep -rn "def <symbol>\|class <symbol>" src/ web/ --include="*.py"

# Read the relevant file sections
# Follow imports: what calls what?
```

Identify the exact line where behaviour diverges from the expected.
Do NOT guess — read the code path fully before forming a hypothesis.

### 3 — State the root cause

Write it out before touching any file:
> "Root cause: `web/db/repository.py:L142` applies the wrong membership scope on project switch —
> it uses `org_id` from the request body instead of the JWT-validated `org_id`."

If you cannot state it precisely, keep reading.

### 4 — Apply the minimal fix

Change only what caused the root cause. No cleanup, no refactoring, no added features.
If you find adjacent issues, note them and leave them for a separate task.

### 5 — Verify

```bash
PYTHONPATH=. MPLBACKEND=Agg python -m pytest <files> -q
```

Full suite must stay green: `PYTHONPATH=. MPLBACKEND=Agg python -m pytest -q`.

### 6 — Stop conditions

- If green after fix: done. Report root cause + file:line + test result.
- If still red after 2 attempts: STOP, report what was tried, escalate.
- If the test itself is wrong: STOP, report to the test author — never edit the test.

## Common failure patterns in this codebase

| Symptom | Likely location | Check |
|---|---|---|
| Wrong data returned for project | `web/db/repository.py` | Missing `.where(Project.id == active_project_id)` |
| PII not redacted | `src/utils/pii.py` · `src/data/transform.py` | `enforce_pii` call path |
| SSE stream hangs | `web/main.py` async generator | Uncaught exception swallowed before `yield` |
| Config not found | `src/utils/config.py` | `env:` prefix not resolved |
| Chart not rendering | `src/reports/charts.py` CHART_DISPATCH | Missing key or wrong fn signature |
| React state stale | `frontend/src/hooks/` | Missing dependency in useEffect |
