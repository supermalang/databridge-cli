---
name: commit
description: Conventional Commits-compliant commit creator linked to the active roadmap task. Pre-flight lint, staged-file audit, message construction, confirmation, execute. No push, no PR.
---

# /commit — Conventional Commits Creator (databridge-cli)

Creates clean, traceable commits linked to the active roadmap task.

## Commit message format

```
<type>(<scope>): <imperative description, ≤ 72 chars>

<optional body — the "why", not the "what"; wrap at 72 chars>

Task: <TASK-ID> — <short title from roadmap>
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

**Types:** `feat` · `fix` · `refactor` · `test` · `docs` · `chore` · `ci` · `perf` · `style`

Never `chore` for DB migrations — use `feat(db)` or `fix(db)`.

**Scopes:** `api` · `cli` · `ui` · `db` · `reports` · `pii` · `auth` · `tests` · `config`

## Workflow

### 1 — Pre-flight checks

```bash
# What's staged?
git diff --cached --stat
git status --short

# Scan for rule violations
git diff --cached | grep -E "console\.log|print\(.*debug|TODO REMOVE|Bearer [A-Za-z0-9]|password\s*=" | head -10

# Python lint
python -m ruff check src/ web/ 2>/dev/null || python -m flake8 src/ web/ --max-line-length=120 2>/dev/null | head -20

# Frontend lint (if JSX staged)
git diff --cached --name-only | grep -q "\.jsx\$" && cd frontend && npm run lint 2>&1 | tail -10
```

If lint fails or rule violations found: STOP, report, do not commit.

### 2 — Read active task

```bash
cat .claude/.active-task.json 2>/dev/null
```

Match the task ID to `docs/ROADMAP.md` to get the short title.
If no active task: note "standalone commit, no roadmap task" and omit the Task line.

### 3 — Build message

Select `type` from the staged changes:
- New behaviour → `feat`
- Bug fixed → `fix`
- Tests only → `test`
- Docs only → `docs`
- DB migration → `feat(db)` or `fix(db)`
- Structure cleanup → `refactor`

Describe the change in the imperative (what the commit does, not what you did):
- ✅ "add pagination to /api/runs endpoint"
- ❌ "added pagination", "I added pagination"

### 4 — Present message + confirm

Show the proposed commit message to the user. In autonomous mode (dispatched by ship-task or
commit agent), proceed without asking.

### 5 — Execute

```bash
git commit -m "$(cat <<'EOF'
<type>(<scope>): <description>

<body if needed>

Task: <TASK-ID> — <title>
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

### 6 — Report

Commit SHA + message summary. Done — push is `pr-reviewer`'s job.
