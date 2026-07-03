---
name: pr-reviewer
description: Final quality gate and PR creator. Two modes: gate (full DoD + push + PR) and audit (read-only diff review). Cannot fix bugs. Use for manual PR creation or as an alternative to ship-task's Ship phase.
---

# /pr-reviewer — Final Quality Gate (databridge-cli)

Two modes:
- **Gate mode** (default): full DoD verification → lint → diff audit → push → PR
- **Audit mode** (`--audit`): diff review only, no writes, no push

## Gate mode workflow

### 1 — Verify Definition of Done

Read the task card. Check each DoD item:

- [ ] Unit tests green: `PYTHONPATH=. MPLBACKEND=Agg python -m pytest -q`
- [ ] Playwright E2E green (UI-facing cards): `cd frontend && npm run test:e2e`
- [ ] impeccable audit/critique clean (UI cards)
- [ ] QA-tester sign-off in `UAT:` field (or `N/A` for non-UI)
- [ ] security-audit returned SECURITY: CLEAR (or N/A)
- [ ] dep-audit run if `requirements*.txt` or `frontend/package.json` changed
- [ ] Roadmap card `- [ ]` (not yet marked done — that happens on merge, not here)
- [ ] docs/reference/ updated if user-facing surface changed

Incomplete DoD item → STOP, report what's missing, do not push.

### 2 — Lint

```bash
cd frontend && npm run lint 2>&1 | grep -E "error|warning" | head -20
python -m ruff check src/ web/ 2>/dev/null | head -20
```

Lint errors → STOP.

### 3 — Diff audit

```bash
git diff develop...HEAD --name-only   # files changed
git diff develop...HEAD               # full diff
```

Check:
- No secrets/tokens hardcoded (`grep -rn "Bearer \|password\s*=\|api_key\s*="`)
- No `console.log` / `print(` debug left in
- All new endpoints gated by `require_role()`
- All DB queries membership-scoped
- `ALLOWED_COMMANDS` not expanded without CLAUDE.md update
- Alembic migration present if `web/db/models.py` changed

### 4 — Push + PR

```bash
git push -u origin $(git branch --show-current)
gh pr create --base develop --title "<type>(<scope>): <description>" --body "$(cat <<'EOF'
## Summary
- <bullet>

## Verification
- [ ] Unit tests: green
- [ ] E2E: green / N/A
- [ ] Visual baselines approved / N/A

## UAT checklist
<copy UAT steps from card — unchecked>

## Review notes
<warnings from security-audit / dep-audit / perf-review / ux-review>

🤖 Generated with Claude Code
EOF
)"
```

Return the PR URL. Never merge — human UAT + review + merge are the user's gate.

## Audit mode workflow

Run steps 1–3 only. Return structured report:
```
pr-reviewer AUDIT

Blockers: <list>
Fixable:  <list>
Nits:     <list>
```

## Constraints

- Only agent authorised to `git push` and `gh pr create`
- Cannot fix bugs or add code — escalate to `/roadmap-task-implementer` or `/debugger`
- Cannot open a PR if any DoD item is incomplete
