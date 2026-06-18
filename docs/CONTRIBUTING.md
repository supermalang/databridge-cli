# Contributing — databridge-cli

This repo uses a **roadmap-governed, git-flow** workflow. Local PreToolUse hooks enforce it for
AI agents (Claude Code); CI + branch protection enforce it for every contributor. Full agent
contract: [CLAUDE.md → Development workflow (gated)](../CLAUDE.md#development-workflow-gated).

## 1. All work is tracked in the roadmap

Every feature/bug/fix must exist as a card in [docs/ROADMAP.md](ROADMAP.md) before implementation.
Each card carries **Acceptance criteria · Unit tests · E2E · UAT**; the roadmap header defines a
single **Definition of Ready** (entry gate) and **Definition of Done** (exit gate). Edit the
roadmap only via the `/roadmap` skill (it rewrites the whole file; the `guard-roadmap` hook and
the `Governance` CI job reject template-incomplete writes).

Exempt from the roadmap gate: minor config, docs/markdown, and harness/tooling changes.

## 2. Branching (git-flow)

```
feature/… ─PR→ develop ─release PR→ main
fix/…    ─┘
chore/…  ─┘
```

- Branch from `develop` using `feature/`, `fix/`, or `chore/`.
- **Never commit directly to `main` or `develop`** — they receive merges only. (`guard-git-flow`
  + `guard-branch` block this locally; branch protection blocks it server-side.)
- Open a PR into `develop`; releases go `develop → main` via a release PR. Delete the branch
  after merge.

## 3. Tests-first

Tests are written **from the Acceptance criteria**, proven to fail, then made to pass — and the
author of the tests is independent of the implementer, so tests validate the requirement, not
the code. Run them with:

```bash
PYTHONPATH=. MPLBACKEND=Agg python -m pytest
```

UI work additionally needs a Playwright E2E + visual check (impeccable `audit`/`critique` +
`toHaveScreenshot`); a human approves the first visual baseline and runs the card's UAT.

## 4. Required GitHub branch protection (repo admin — one-time)

CI cannot enforce "no direct pushes" by itself; configure branch protection for **both `main`
and `develop`**:

- **Require a pull request before merging** (disallow direct pushes).
- **Require approvals** — at least 1 review.
- **Require status checks to pass** — select the **Governance / Validate roadmap template**,
  **Governance / Enforce git-flow PR direction**, and **CI / Python tests** checks.
- **Do not allow bypassing** the above for administrators (recommended).

With these on, the local hooks are the fast inner loop and CI + protection are the wall.
