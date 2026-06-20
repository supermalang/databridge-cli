---
name: discovery
description: Product discovery and requirements kickoff. Iteratively interviews the user — blending requirements gathering, PRD writing, Agile story slicing, and Design Thinking — until the problem, user, and solution are clear, then writes a product brief that /roadmap turns into roadmap cards. Use at the very start, before any task exists.
---

# /discovery — Product Discovery & Requirements

Before starting, read **CLAUDE.md** (project, architecture, absolute constraints) and
[`docs/ROADMAP.md`](../../docs/ROADMAP.md) so questions use the project's own vocabulary and don't
re-ask known facts.

## Role

The front door of the workflow. Runs **before** `/roadmap`. Its job is to make sure we're building
the *right* thing before any card is written or any code is touched. It blends four lenses:

- **Requirements gathering** — functional and non-functional requirements, constraints, dependencies.
- **PRD discipline** — problem, goals, scope, success metrics, risks.
- **Agile** — slice the work into INVEST user stories with testable acceptance criteria.
- **Design Thinking / HCD** — start from the user's job-to-be-done and pain, not the feature.

It is **conversational and iterative**: it asks focused questions in small batches, absorbs any
document the user provides, and keeps going until the picture is clear. It does **not** write code,
tests, or roadmap cards — it produces a **product brief** that `/roadmap` (via the
`roadmap-planner` agent) consumes.

## Permissions

✅ CAN read    : all project files · any document or text the user provides for context
✅ CAN write   : `docs/discovery/<slug>.md` only (the product brief)
✅ CAN run     : read-only git commands (`git log`, `git branch`) for context
❌ CANNOT      : write to source, tests, or `docs/ROADMAP.md` (the roadmap belongs to `/roadmap`)
❌ CANNOT      : create branches, run migrations, builds, or tests
❌ CANNOT      : finalise a brief while critical fields are still unknown — keep asking instead

## Argument (optional)

```
/discovery                          # Pure interview mode — starts from scratch
/discovery "feature idea or goal"   # Starts from a one-line idea
/discovery path/to/notes.md         # Reads the document first, then asks only what's missing
```

If the user references a document (brief, ticket, transcript, email), **read it first** and extract
everything before asking anything.

---

## Step-by-step

### 1 — Intake: absorb what already exists

1. If the user provided a document, file path, or pasted text → read it fully.
2. Read `docs/ROADMAP.md` and CLAUDE.md to learn the existing product, layers, and domain — so you
   don't re-ask known facts. The domain here is Kobo/Ona survey data → filtered extraction →
   charts → Word reports, configured through a single `config.yml`.
3. Build a private working model of: **who** the user is, **what** problem they have, **why** it
   matters, **what** a solution looks like. Note every field you can already fill and every unknown.

Do not ask about anything you can already answer from intake.

### 2 — Frame the problem (Empathise + Define)

Confirm, before discussing any solution:

- **User / persona** — who experiences this problem? (M&E officer, data analyst, report author, admin?)
- **Job-to-be-done** — what are they trying to accomplish?
- **Pain / trigger** — what's hard, slow, or broken today? What happens if nothing changes?
- **Current workaround** — how do they cope now?

If the user jumps straight to a feature ("add a chart type"), walk it back to the underlying job and
pain before accepting it as the solution.

### 3 — Iterative interview (the core loop)

Ask questions in **small, focused batches** — never a giant checklist. Prefer the `AskUserQuestion`
tool for closed choices; plain questions for open ones. After each answer:

1. Update your working model.
2. Reflect back what you now understand in one or two sentences.
3. Identify the **single most important remaining unknown** and ask about that next.

Repeat until the **Definition of Clear** (below) is satisfied. Cover, across the batches:

- **Scope** — what is explicitly in, and just as important, what is explicitly *out* (non-goals).
- **Success metrics** — how will we know it worked? (qualitative and quantitative)
- **Constraints** — deadlines, compliance, existing systems, the project's absolute rules.
- **Non-functional requirements** — performance, accessibility, offline (AI features no-op offline), i18n.
- **Edge cases & failure modes** — what should happen when input is unusual or a step fails.
- **Assumptions & risks** — what we're betting on, and what could invalidate it.

Stop asking as soon as the picture is clear. If the user says "you decide," record a stated
assumption and move on rather than pressing.

### 3b — Threat / safety pass (shift left)

Before the brief is final, do a lightweight pass — cheaper to design in than to review out. For the
proposed solution, identify the project's real constraints (see CLAUDE.md → Key implementation details):

- **Data sensitivity** — does this touch submission PII? The PII gate (`src/utils/pii.py`) is
  **fail-closed** in `export_data`; anything writing to `data/processed` or the DB must stay redacted
  + consent-gated.
- **Tenant scoping (RBAC)** — every app-DB query is membership-scoped (`ProjectMembership`,
  `owner_id`, `is_superadmin`). A new endpoint/feature must respect `require_role()` gating.
- **Trust boundaries** — untrusted input enters via Kobo/Ona payloads, uploaded config, and run
  commands (only `ALLOWED_COMMANDS` are runnable — no arbitrary shell).
- **Run isolation** — per-run tempdirs, one run per project (409), concurrency cap (429).

Capture findings in the brief's threat-model section — they become explicit acceptance criteria and
feed `/security-review` later, instead of being discovered at review time.

### 4 — Definition of Clear (gate before writing the brief)

Do not write the brief until every item holds:

- [ ] The user/persona and their job-to-be-done are explicit
- [ ] The problem and its impact are stated (why it matters now)
- [ ] Goals and **non-goals** are both written
- [ ] At least one measurable success metric exists
- [ ] Key constraints and non-functional requirements are captured
- [ ] Major assumptions and risks are listed
- [ ] The solution is sliced into at least one INVEST-shaped user story with testable acceptance criteria

If any item is unmet → return to step 3 and ask. State which items are still open.

### 5 — Synthesise the product brief

Write `docs/discovery/<slug>.md` (slug = short kebab-case name) using this structure. For a
multi-step flow, use `/diagram flow` to embed a Mermaid flowchart — a picture surfaces gaps prose hides.

```markdown
# Product Brief — <Title>

**Date:** <today>   **Status:** Draft   **Author:** /discovery

## 1. Problem & user
- Persona / user:
- Job-to-be-done:
- Pain / trigger today:
- Current workaround:

## 2. Why now (impact)
<What changes if we solve this — and the cost of not solving it.>

## 3. Goals
- <Outcome 1>

## 4. Non-goals (out of scope)
- <Explicitly not doing X>

## 5. Success metrics
- <Measurable signal that this worked>

## 6. Solution overview
<Plain-language description from the user's perspective.>

## 7. User stories (draft — for /roadmap)
- **Story A** — As a <persona>, I want <action> so that <benefit>.
  - Acceptance criteria:
    - [ ] <Concrete, verifiable criterion>
    - [ ] <Edge case>

## 8. Constraints & non-functional requirements
- Performance / scale:
- Accessibility / i18n:
- PII / RBAC / compliance:
- Other (offline AI no-op, export targets):

## 8b. Safety & threat model (initial)
- Data sensitivity (submission PII, consent gating):
- Tenant scoping (membership / require_role):
- Trust boundaries (Kobo payload, uploaded config, run commands):
- Applicable absolute rules (PII fail-closed, ALLOWED_COMMANDS, run isolation):

## 9. Assumptions
- <Bet we're making>

## 10. Risks & open questions
- <Risk> — mitigation:

## 11. Suggested slicing for the roadmap
<Ordered list of stories sliced thin enough to ship independently, smallest valuable increment first.>
```

Each user story must be **INVEST**-shaped. Lead acceptance criteria with the nominal case, then
edge cases — the same shape the `roadmap-planner` agent expects when turning stories into cards.

### 6 — Confirm with the user

Present a tight summary (problem, goals, non-goals, the sliced stories). Ask for explicit
confirmation or corrections before handing off. Apply any final edits.

### 7 — Handoff

```
✅ Discovery complete — brief written to docs/discovery/<slug>.md
🎯 Problem & user   : clear
📐 Stories drafted  : N (INVEST, with acceptance criteria)
⚠️  Open risks      : <count, or none>
➡️  Next step       : /roadmap — turn the drafted stories into roadmap cards (roadmap-planner)
```

---

## What discovery does NOT do

- Does not write roadmap cards — it drafts stories; `/roadmap` owns `docs/ROADMAP.md`.
- Does not touch source or tests.
- Does not assign IDs or estimate sprints (that's the `roadmap-planner` agent via `/roadmap`).
- Does not stop while the Definition of Clear is unmet — it keeps interviewing.
