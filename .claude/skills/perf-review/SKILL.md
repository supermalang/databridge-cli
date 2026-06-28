---
name: perf-review
description: Static performance analyser for FastAPI/SQLAlchemy/React code. Checks N+1 queries, unbounded selects, over-fetching, unparallelised async, and missing indexes. Report-only in ship-task. A slow query is a DoS risk.
---

# /perf-review — Static Performance Analyser (databridge-cli)

Audits the active task's diff for performance anti-patterns without running the app.
Complements `/perf-measure` (which observes actual runtime metrics).

> "A slow query in production is a security risk (DoS, resource exhaustion) as much as a performance issue."

## Scope

```bash
git diff --name-only HEAD   # changed files
```

Focus: `web/main.py`, `web/db/repository.py`, `src/data/transform.py`, `src/data/flatten.py`.
Sample: `frontend/src/` for waterfall fetches and render-blocking patterns.

## Check 1 — N+1 queries

Look for loops that call `session.execute()` / `.scalars()` / `.scalar_one()` per iteration.

```python
# BAD — N+1 over submissions
for row in rows:
    meta = session.execute(select(RunMeta).where(RunMeta.id == row.id)).scalar_one()

# FIX — eager load
rows = session.execute(
    select(Submission).options(selectinload(Submission.meta))
).scalars().all()
```

Hot paths: anything iterating over Kobo submissions, project memberships, or run logs.

## Check 2 — Unbounded queries

Any `select(Model)` without `.limit()` on tables that grow with user data:
`ProjectMembership`, `OrgUser`, configs with many questions, run logs.

```python
# BAD
all_runs = session.execute(select(Run).where(Run.project_id == pid)).scalars().all()

# FIX — paginate
runs = session.execute(
    select(Run).where(Run.project_id == pid).order_by(Run.created_at.desc()).limit(50)
).scalars().all()
```

## Check 3 — Over-fetching

`select(Model)` when only 2-3 columns are needed. Use column-level select.

```python
# BAD
projects = session.execute(select(Project)).scalars().all()
names = [p.name for p in projects]

# FIX
names = session.execute(select(Project.name)).scalars().all()
```

## Check 4 — Unparallelised async (FastAPI endpoints)

Sequential `await` on independent coroutines.

```python
# BAD
config = await get_config(project_id)
members = await get_members(project_id)

# FIX
config, members = await asyncio.gather(get_config(project_id), get_members(project_id))
```

## Check 5 — Missing indexes

New FK columns or filter columns without `Index(...)` in `web/db/models.py`.
Escalate index additions to `/schema-agent` — do not add them directly if a migration is needed.

## Check 6 — Pandas hot paths

In `src/data/flatten.py` and `src/data/transform.py`:
- `df.apply(fn, axis=1)` on large frames → prefer vectorised ops
- `df[df.col == val]` in a loop over unique values → use `df.groupby('col')`

## Severity

| Level | Examples |
|---|---|
| Critical | Unbounded query on a growing table; N+1 in every API request |
| High | N+1 in a hot path; unparallelised sequential awaits on user-facing endpoints |
| Warning | Over-fetching; missing index suggestion; non-critical Pandas apply |

## Output

```
perf-review CLEAR / BLOCKED

Blockers:
- <file:line> · <pattern> · <issue> · <fix>

Warnings:
- <file:line> · <pattern> · <suggestion>
```

Report-only in ship-task (no edits). May apply non-schema fixes in manual mode.
