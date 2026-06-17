# Roadmap-governed development workflow — design

_Date: 2026-06-17_

## Problem

We want all real work on databridge-cli to be **tracked in `docs/ROADMAP.md`** before it
happens, and every roadmap entry to follow one rigorous template — Definition of Done,
tests-first, unit tests, E2E tests, and UAT per feature (plus a golden-path E2E + UAT per
sprint). Two enforcement goals:

1. The roadmap file can't be written in a way that skips the template.
2. No feature / bug / fix work happens unless it's already a roadmap task — **except minor
   config, docs, and tooling**, which stay friction-free.

## Enforcement model (and its honest limit)

Three layers, because no single mechanism does the whole job:

- **The `/roadmap` skill** — the brains. Encodes the template + workflow. *Advisory*: the
  agent invokes it; it cannot enforce itself.
- **CLAUDE.md rules** — what actually steers the agent before it acts (the "gate before
  coding" rule, "roadmap edits go through `/roadmap`", the testing contract).
- **PreToolUse hooks** — the deterministic backstop. The harness runs them and they can
  block a tool call (exit 2).

**Limit we accept:** a hook cannot know "was the skill used" or "does a matching roadmap task
exist for this intent." So:
- The roadmap guard validates the **content shape** of the result (outcome), not the process.
- The coding gate keys off a **marker file** the skill sets; it's a strong guardrail, but
  bypassable by an agent that writes the marker directly. This is acceptable — the goal is to
  make the tracked path the path of least resistance, not to be tamper-proof against
  ourselves.

## Non-goals

- Tamper-proof enforcement against a determined agent/user.
- Validating partial (`Edit`) changes to the roadmap — the skill always rewrites the whole
  file so the guard can validate it.
- Browser visual testing infra beyond Playwright's built-in `toHaveScreenshot`.

## Components

### 1. The `/roadmap` skill — `.claude/skills/roadmap/SKILL.md`

Single entry point for **any** roadmap change: add a task/sprint, edit one, start
implementing one, mark one done. Responsibilities:

- **Owns the template.** Every task card must contain these labelled fields (the guard checks
  for them):
  - `ID` — `AREA-N` (e.g. `OUT-1`, `UX-3`, `ME-2`, `INF-1`)
  - **Definition of Done** — the explicit completion bar
  - **Tasks** — implementation steps
  - **Unit tests** — pytest file + cases, specified before implementation
  - **E2E** — Playwright spec + visual snapshot (`toHaveScreenshot`); `N/A (reason)` allowed
    only for non-UI/non-flow tasks
  - **UAT** — manual numbered checklist (human-run steps + expected results)
  - supporting: Files · Config/schema impact · Verify · Status (`- [ ]` / `- [x]`)
- **Sprint-level:** each sprint carries a golden-path E2E (`SP-N-E`) and a sprint UAT.
- **Writes the whole `ROADMAP.md`** (never partial), keeping the Global status table in sync.
- **Sets the active-task marker** when implementation starts: writes
  `.claude/.active-task.json` = `{ "id": "<AREA-N>", "started_at": "<ISO8601>" }`. This is what
  unblocks edits to gated paths.
- **Enforces tests-first:** unit + E2E specs are written (and failing) before implementation;
  DoD is unmet until all green + visual baseline committed + UAT checked.
- **Closeout:** flip `- [ ]`→`- [x]`, update Global status counts, clear the marker.

### 2. Hook — roadmap content guard (`.claude/hooks/guard-roadmap.sh`)

PreToolUse, matcher `Write|Edit`, acts only when `tool_input.file_path` ends with
`docs/ROADMAP.md`:

- **Write:** read `tool_input.content`. Require invariants:
  - line 1 is the roadmap H1
  - a `## Global status` section with a table
  - for **every** task bullet (`- [ ] **AREA-N — …**` / `- [x] …`), the card body contains the
    labels `Definition of Done`, `Unit tests`, `E2E`, and `UAT`.
  - On any miss → **exit 2** with a message naming the offending task ID(s) and missing
    label(s), and "Use `/roadmap`."
- **Edit:** **exit 2** unconditionally — "Roadmap changes go through `/roadmap`, which rewrites
  the whole file (a partial edit can't be template-validated)."

Implementation note: the per-card check is a text scan (awk/grep) keyed on the `- [ ]`/`- [x]`
bullets and the section that follows each until the next bullet or `##`. Tolerant of ordering.

### 3. Hook — coding gate (`.claude/hooks/guard-coding.sh`)

PreToolUse, matcher `Write|Edit|MultiEdit`, acts on `tool_input.file_path`:

- **Gated** if the path matches `src/`, `web/`, `frontend/src/`, or `tests/`.
- **Exempt** otherwise — config (`config.yml`, `sample.config.yml`, `.env*`, `requirements*.txt`,
  `pyproject.toml`, `package.json`, `*.config.js`), docs (`docs/**`, `*.md`), harness/tooling
  (`.claude/**`, `scripts/**`, `.github/**`).
- For a gated path: require `.claude/.active-task.json` to exist, be **fresh** (`started_at`
  within TTL = **8h**), and its `id` to still be an open task (`- [ ]`) in `ROADMAP.md`.
  - Pass → exit 0.
  - Missing/stale/closed → **exit 2**: "No active roadmap task. Use `/roadmap` to register or
    select the task you're implementing (it sets the active-task marker). Config/docs/tooling
    edits are exempt."

### 4. CLAUDE.md additions — "Development workflow (gated)"

A new section stating the rules the agent follows by default:

- **Gate before coding.** Before writing implementation code (feature, bug, or fix), confirm
  the task exists in `docs/ROADMAP.md` and start it via `/roadmap` (sets the marker). Exempt:
  minor config, docs, and harness/tooling changes.
- **Roadmap edits go through `/roadmap`.** Never hand-edit `docs/ROADMAP.md`.
- **Testing contract.** Each task: pytest unit tests + a Playwright E2E with a visual snapshot
  + a manual UAT checklist; tests written first; DoD = all green + visual baseline + UAT
  signed. Each sprint: a golden-path E2E (`SP-N-E`) + sprint UAT.
- A short "Harness" note pointing at the skill + the two hooks as the backstop.

### 5. Playwright + visual harness (Phase 2)

- `frontend/playwright.config.js` (baseURL → `./scripts/serve.sh` on `:8000`; `webServer` to
  boot it; snapshot config).
- `frontend/tests/e2e/` — an app-up fixture, a smoke spec, and one `toHaveScreenshot()` visual
  baseline as the reference example.
- npm scripts: `test:e2e`, `test:e2e:update` (refresh baselines).
- CI: a Playwright job (install browsers, build, run) — may land as a follow-up task.
- Committed snapshot baselines under `frontend/tests/e2e/__screenshots__/`.

## settings.json wiring

Register both hooks under `hooks.PreToolUse` (merged with the existing pytest allowlist):

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Write|Edit",            "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/guard-roadmap.sh" }] },
      { "matcher": "Write|Edit|MultiEdit",  "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/guard-coding.sh" }] }
    ]
  }
}
```

Each script exits 0 fast when the path is outside its domain.

## Marker mechanics

- File: `.claude/.active-task.json`, gitignored (`.claude/.active-task*`).
- Shape: `{ "id": "AREA-N", "started_at": "ISO8601" }`.
- Set by `/roadmap` on "start implementing"; cleared on closeout.
- TTL 8h: a stale marker fails the gate, forcing a conscious re-start via `/roadmap`.

## Phasing

- **Phase 1 — governance (ship first):** the `/roadmap` skill, both hooks, settings wiring,
  `.gitignore`, CLAUDE.md rules. Self-contained; E2E referenced but not yet runnable.
- **Phase 2 — Playwright/visual harness:** component 5. Registered as the first real
  `/roadmap` task (`INF-1`), dogfooding the system. The harness config is exempt tooling; the
  e2e specs are gated, so building them exercises the marker flow.

## Testing taxonomy

| Tier | Tool | Scope | Gate |
|---|---|---|---|
| Unit | pytest | per task | required, written first |
| E2E | Playwright + `toHaveScreenshot` | per UI/flow task | required (UI), `N/A(reason)` otherwise |
| Golden-path E2E | Playwright | per sprint (`SP-N-E`) | required |
| UAT | manual checklist | per task + per sprint | human sign-off |

## Defaults chosen (no further input needed)

- Marker TTL 8h.
- Visual checks via Playwright built-in `toHaveScreenshot` (not Percy/Applitools/etc.) unless
  changed.
- Roadmap `Edit` always blocked; skill rewrites whole file.
- `tests/**` is gated (tests written inside a tracked task).

## Risks

- **Hook noise / false blocks** — mitigated by fast-exit on exempt paths and clear messages.
- **Self-referential bootstrap** — Phase 1 artifacts are all exempt (`.claude/**`, `docs/**`),
  so they can be built without tripping the coding gate.
- **Roadmap guard brittleness on card parsing** — keep the scan tolerant (label presence, not
  strict order); covered by a fixture test of the hook against good/bad roadmap samples.
