---
name: dep-audit
description: Audit dependencies for known vulnerabilities (SCA — OWASP A06) and outdated packages across both the Python (requirements*.txt) and frontend (frontend/package.json) trees, then propose the safest upgrade path with a build+test compatibility check. Run before shipping a release and on a schedule.
---

# /dep-audit — Dependency & Vulnerability Audit

Before starting, read **CLAUDE.md** (project, tech stack, commands) and skim
[`docs/reference/internals.md`](../../docs/reference/internals.md) for context.

## Role

Closes the supply-chain gap (OWASP **A06 — Vulnerable and Outdated Components**) that code review
alone can't catch. databridge-cli has **two** dependency trees — Python (root `requirements.txt` +
`requirements-dev.txt`) and the Vite frontend (`frontend/package.json`) — so both get scanned.
Pairs with `/security-review`, which reviews the code; this audits what the code depends on.

## Permissions

✅ CAN read    : all project files · lockfiles · manifests
✅ CAN write   : dependency manifests + lockfiles — **patch/minor security upgrades only**, after a compatibility check
✅ CAN run     : audit + outdated commands · install · build · the test suite (to verify an upgrade)
❌ CANNOT      : apply a **major** version bump without explicit user confirmation (breaking changes)
❌ CANNOT      : modify source, tests, or `docs/ROADMAP.md`
❌ CANNOT      : push or open PRs
❌ CANNOT      : silently suppress a vulnerability — record any accepted risk explicitly

> Manifests (`requirements*.txt`, `frontend/package.json`) live outside the roadmap-gated paths
> (`src/`, `web/`, `frontend/src/`, `tests/`), so a security bump does not need an active task —
> but call it out in the commit and keep the change surgical.

## Stack commands

| Tree | Audit | Outdated | Verify upgrade |
|---|---|---|---|
| Python (root) | `pip-audit -r requirements.txt -r requirements-dev.txt` | `pip list --outdated` | `PYTHONPATH=. MPLBACKEND=Agg python -m pytest -q` |
| Frontend (`frontend/`) | `npm audit` | `npm outdated` | `npm run build` + `npm run test:e2e` |

> `pip-audit` may not be installed — `pip install pip-audit` first, or fall back to
> `pip install safety && safety check -r requirements.txt`.

---

## Step-by-step

### 1 — Run the audit (both trees)

Run the SCA command for each tree and capture the full report. Note totals by severity
(Critical / High / Moderate / Low) per tree.

### 2 — Triage by severity and reachability

For each vulnerability:
- **Severity** — Critical/High are blockers; Moderate/Low are should-fix.
- **Reachability** — is the package a direct dependency the app actually uses, or a deep transitive
  one on a code path never hit? A reachable Moderate can outrank an unreachable High. State the reasoning.
- **Fix availability** — is there a patched version, and is the fix a patch, minor, or major bump?

### 3 — Propose the safest upgrade path

- Prefer **patch → minor → major**, in that order. The smallest version jump that clears the
  vulnerability wins — do not chase the newest version.
- For a major bump, **do not apply automatically** — surface the breaking-change risk + changelog
  and let the user decide.
- Watch pins that matter here: `pandas`, `matplotlib`, `numpy` (chart rendering),
  `sqlalchemy` 2.0 + `alembic`, `fastapi`/`uvicorn`, `docxtpl`. A careless bump here breaks charts,
  migrations, or report rendering — verify against the suite.

### 4 — Apply and verify (safe upgrades only)

For patch/minor security fixes:
1. Update the manifest (+ lockfile for npm).
2. Reinstall (`pip install -r requirements.txt` / `cd frontend && npm install`).
3. Run **build + the test suite** — an upgrade that breaks tests is not a fix. For chart/report
   deps, the pytest suite (with `MPLBACKEND=Agg`) is the real gate.
4. If anything breaks, revert and report it as requiring manual handling.

### 5 — Report

```
🛡️  Dependency audit — Python + frontend
🔴 Critical : X  → [fixed via patch/minor | needs major bump → user decision]
🟠 High     : Y  → …
🟡 Moderate : Z  → …
📦 Outdated (non-security) : N packages — listed, not auto-bumped
⚠️  Accepted risks : <vuln + justification, or none>
✅ Build + tests after upgrades : pass / fail
➡️  Next step : /security-review (code) · /code-review (diff)
```

---

## What dep-audit does NOT do

- Does not chase the newest version — only what clears a vulnerability or an explicit request.
- Does not apply major bumps unattended.
- Does not review application code (that's `/security-review`).
- Does not silently ignore findings — accepted risk is always recorded.
