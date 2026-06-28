---
name: usability-test
description: Usability testing across three modes — heuristic evaluation (Nielsen 10, Claude runs it), real-user test protocol (human runs it), and findings synthesis. Writes docs/usability/<slug>.md. Never edits source.
---

# /usability-test — Usability Testing (databridge-cli)

Closes the loop that criteria-based QA can't: **can a real person actually accomplish the
goal, and where do they struggle?** `/qa-tester` checks acceptance criteria are *met*;
usability testing asks whether the result is *usable* — discoverable, learnable, low-friction.

Before starting, read `.claude/context.md` and, if present, `DESIGN.md` and the task's AC.

**Honest boundary:** Claude cannot recruit or be real users. It *can* run a rigorous
heuristic evaluation itself, and it *can* prepare the protocol and synthesize findings —
but real-user sessions are run by a human.

## Permissions

✅ CAN read   : all project files, `DESIGN.md`, acceptance criteria, `context.md`
✅ CAN write  : `docs/usability/<slug>.md`
✅ CAN run    : dev server, browser-drive the app (screenshots, DOM, console)
❌ CANNOT     : edit source, tests, or schema — improvements become `/roadmap` tasks
❌ CANNOT     : claim real-user results from a heuristic pass — label findings by source

## Argument

```
/usability-test heuristic <route-or-feature>   # Claude evaluates against Nielsen's 10
/usability-test plan <feature>                 # write a real-user test protocol for a human
/usability-test synthesize <notes-file|paste>  # turn session notes into prioritized improvements
```

---

## Mode 1 — Heuristic evaluation (Claude runs it)

Start the app (`./scripts/dev.sh`) and navigate to the target route. Evaluate against
**Nielsen's 10 heuristics**:

1. Visibility of system status
2. Match between system and the real world
3. User control and freedom
4. Consistency and standards
5. Error prevention
6. Recognition rather than recall
7. Flexibility and efficiency of use
8. Aesthetic and minimalist design
9. Help users recognize, diagnose, and recover from errors
10. Help and documentation

For each issue found: heuristic violated · where (route/selector) · **severity**
(0 cosmetic → 4 catastrophe) · fix direction.

This overlaps `/ux-review` on visuals but focuses on **task flow and friction**, not
visual harmony.

## Mode 2 — Plan a real-user test (human runs it)

Write a protocol a non-expert can execute with 3–5 representative users:

- **Goal & hypotheses** — what we're trying to learn, what we fear is confusing
- **Participant profile** — M&E officer or field coordinator (from `PRODUCT.md`), criteria
- **Tasks** — 3–6 realistic, goal-oriented scenarios ("download the Q2 dataset and build
  a report"), *not* instructions ("click the blue button")
- **Measures** — task success rate, time-on-task, error count, post-test SUS (10-item
  System Usability Scale) or short confidence/satisfaction survey
- **Logistics** — moderated vs unmoderated, think-aloud prompt, what to record

## Mode 3 — Synthesize findings (Claude themes them)

Take raw session notes and:
- Cluster observations into **themes** ("users miss the save action")
- Rate each by **severity × frequency** (how many users hit it, how badly)
- Translate top themes into **concrete improvements** as `/roadmap` tasks
  (`Type: Fix` for broken flows, `Feature` for missing affordances), each with evidence
  ("4/5 users…")

---

Write all modes to `docs/usability/<slug>.md`, labelling every finding **[heuristic]** or
**[user-tested]** so a heuristic guess is never mistaken for observed behaviour.

## Report back

```
✅ Usability <mode> → docs/usability/<slug>.md
🔎 Findings   : <n>  (top severity: <n>)
➡️  Next       : /roadmap for the prioritized improvements (Fix flows first)
```

## What usability-test does NOT do

- Does not pass off heuristic evaluation as real-user evidence — sources are labelled
- Does not edit code — findings become roadmap tasks
- Does not replace `/ux-review` (visual/a11y) or `/qa-tester` (criteria) — tests task usability
- Does not bless baselines or capture visual snapshots (that's `/test-writer`)
