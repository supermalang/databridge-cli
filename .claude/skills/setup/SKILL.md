---
name: setup
description: One-time stack-kickoff that detects the existing repo and populates .claude/context.md + CLAUDE.md [CONFIGURE] blocks + stack-profile.sh. Use when onboarding a new developer or re-syncing operational config after a major stack change.
---

# /setup — Stack Kickoff (databridge-cli)

One-time technical configuration tool. Detects what it can infer from the repo, asks only about
gaps, then writes the five core operational files. Does **not** scaffold application code.

> Note: databridge-cli is already configured. Use `/setup` when onboarding a new developer,
> adding a new environment (staging, prod), or after a major stack change (new DB, new AI provider).

## Scope boundaries

| May do | Must not do |
|---|---|
| Read any file for detection | Scaffold source code or components |
| Run lint/test commands once for verification | Install npm/pip dependencies |
| Write `.claude/context.md` | Run migrations or builds |
| Fill `[CONFIGURE]` blocks in `CLAUDE.md` | Modify `docs/ROADMAP.md` |
| Update `.claude/hooks/stack-profile.sh` | Include concrete tool names in agent definitions |

## Workflow (five steps)

### 1 — Detect (read manifests, ask nothing yet)

```bash
# Python version + deps
python3 --version
head -5 requirements.txt requirements-dev.txt

# Node / frontend
node --version
cat frontend/package.json | python3 -m json.tool | grep -E '"name"|"scripts"'

# DB
grep "DATABASE_URL\|SQLALCHEMY" .env.example 2>/dev/null || echo "check CLAUDE.md env table"

# Storage
grep "S3_\|MINIO" .env.example 2>/dev/null

# AI providers
grep "OPENAI\|ANTHROPIC\|LANGFUSE" .env.example 2>/dev/null
```

### 2 — Interview (gaps only)

Ask only what the repo doesn't answer:
- Which environment is being set up? (dev / staging / prod)
- What AI provider(s) will be active?
- Is `KIE_API_KEY` available (for `/report` illustrated style)?
- Any org-specific brand overrides (logo path, colors)?

### 3 — Gate (verify all fields are settled before writing)

Required fields before writing `.claude/context.md`:
- Project name + description ✓ (already in context.md)
- Tech stack versions (detect from manifests)
- Dev/test commands ✓ (in context.md)
- Absolute rules ✓ (in context.md)
- Brand tokens (for `/report`)

### 4 — Configure

Write or update `.claude/context.md` with concrete values.
Fill any `[CONFIGURE]` placeholders in `CLAUDE.md`.
Update `.claude/hooks/stack-profile.sh` if the stack changed.

### 5 — Verify

```bash
# Python tests
PYTHONPATH=. MPLBACKEND=Agg python -m pytest -q --tb=no 2>&1 | tail -3

# Frontend lint
cd frontend && npm run lint 2>&1 | tail -5
```

Report: which commands succeeded, which failed, what needs human attention.

## Abstraction boundary (important)

Exact tool names (`pip-audit`, `playwright`, `pandoc`) live **only** in `context.md` and config
files. Agents and the Definition of Done stay stack-agnostic — they invoke *named commands*
from context, not hardcoded binaries. This allows the pipeline to work across stacks.
