---
name: report
description: Generate a branded progress report (markdown + optional PPTX deck) from roadmap status and git history. For standups, sprint reviews, or steering meetings. Reads roadmap + git — never invents progress.
---

# /report — Progress Report & Deck Generator (databridge-cli)

Synthesizes completed work into stakeholder-ready progress reports. Reads roadmap + git history.
All claims must trace to a roadmap card or a commit — no invented progress.

## Usage

```
/report                         # full progress report (all time)
/report --period "Q3 2026"      # scoped to a period label
/report --style deck            # emit as PPTX deck (requires pandoc)
/report --style illustrated     # emit illustrated deck (requires KIE_API_KEY)
```

## Permissions

- ✅ Read roadmap, git history, `PRODUCT.md`, `DESIGN.md`, `.claude/context.md`
- ✅ Write to `docs/reports/<date>-<scope>.md`
- ✅ Write binary outputs to `out/` (gitignored: PDFs, PPTXs)
- ✅ Run `git log`, `git shortlog`, `pandoc`, `node .claude/reporting/generate-image.mjs`
- ❌ Modify source code, tests, or `docs/ROADMAP.md`
- ❌ Mark roadmap cards `[x]` or open PRs
- ❌ Invent metrics not in roadmap/git

## Workflow

### 1 — Gather evidence

```bash
# Roadmap summary
grep -E "^\- \[x\]|^\- \[ \]|^##" docs/ROADMAP.md

# Commits this period (adjust range as needed)
git log --oneline --since="30 days ago" --no-merges

# Global status table
grep -A 20 "## Global status" docs/ROADMAP.md
```

Read `PRODUCT.md` for outcome framing and `DESIGN.md` for brand voice (clear · neutral · institutional).

### 2 — Draft the report

Write to `docs/reports/<YYYY-MM-DD>-progress.md` using this structure:

```markdown
# Progress Report — <period or date>

## Executive summary
<2–4 sentences, outcome-focused. What got better for users? Reference product goals from PRODUCT.md.>

## Done this period
| ID | Task | Business value |
|---|---|---|
| MNT-7 | Express Template Fill | Users can fill reports without re-uploading data |

## In progress
| ID | Task | Status | Confidence |
|---|---|---|---|

## Blocked / risks
<Honest. If nothing blocked, say so.>

## Next up (prioritized)
<P0 items first, then P1.>

## Metrics
| Metric | Value |
|---|---|
| Tasks completed | N |
| Tasks in progress | N |
| Test coverage (Python) | run `python -m pytest --co -q \| tail -1` |
| Commits this period | N |
```

### 3 — Emit a deck (optional)

**Classical (default — requires pandoc):**
```bash
pandoc docs/reports/<date>-progress.md \
  -o out/<date>-progress.pptx \
  --reference-doc docs/assets/reference.pptx 2>/dev/null \
  || pandoc docs/reports/<date>-progress.md -o out/<date>-progress.pptx
```

**Illustrated (requires `KIE_API_KEY`):**
```bash
# Generate cover image
node .claude/reporting/generate-image.mjs \
  --prompt "M&E progress report cover, deep teal #0F766E, institutional, minimal, data visualization" \
  --out out/assets/cover.png

# Then use the cover in the deck
pandoc docs/reports/<date>-progress.md \
  -o out/<date>-progress.pptx \
  --metadata title="Progress Report"
```

Binary outputs go to `out/` — gitignored. Never commit PDFs or PPTXs.

## Brand tokens (from `.claude/context.md`)

- Accent: `#0F766E` (Deep Field Teal) — use sparingly, one action color
- Fonts: Inter (body) · JetBrains Mono (data/code)
- Voice: clear · neutral · institutional — no consumer/playful copy
- Never manufacture enthusiasm. If a period was slow, say so.

## Quality gates

Before writing the report:
- Every "Done" item must appear in the roadmap as `- [x]`
- Every metric must come from a real command output or roadmap count
- No task marked `[x]` that isn't actually in `docs/ROADMAP.md`
