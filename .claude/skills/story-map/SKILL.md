---
name: story-map
description: Story mapping + impact mapping. Maps existing roadmap tasks into a 2-D release-slice grid from PRODUCT.md personas/journeys. Flags journey gaps for /roadmap. Writes docs/story-map.md.
---

# /story-map — Story Mapping & Impact Mapping (databridge-cli)

Builds a visual product-planning view that sits above the flat backlog. Reveals what's
covered, what's missing, and whether the current release slice lets users complete a
full end-to-end journey.

## Permissions

✅ CAN read   : `PRODUCT.md`, `docs/ROADMAP.md`, discovery notes, `docs/reference/`
✅ CAN write  : `docs/story-map.md`
❌ CANNOT     : create roadmap cards (that's `/roadmap`), modify code/tests, invent scope

## Core concepts

**Story map** — Backbone activities arranged left-to-right (the user journey), with
stories stacked vertically beneath each activity, sliced horizontally by release.
The top slice must be a **walking skeleton** — a thin but end-to-end thread where a
user can complete the full journey, even minimally.

**Impact map** — Goal → Actors → Impacts (behaviour changes) → Deliverables.
Traces what we're building back to measurable outcomes. Surfaces misalignments.

## Workflow

### 1 — Extract personas and journeys

Read `PRODUCT.md`. Identify:
- Who are the users (personas)?
- What is their end-to-end journey through the tool?

For databridge-cli, the primary journey is roughly:
`Connect → Fetch schema → Configure questions → Download data → Build report → Export`

### 2 — Map roadmap tasks into the grid

Read `docs/ROADMAP.md`. For each open and done card, place it under:
- The **activity** it belongs to (column)
- The **release slice** it targets (row)

Flag any journey step with no roadmap coverage as `⚠️ GAP`.

### 3 — Write docs/story-map.md

```markdown
# Story Map — databridge-cli

## Backbone (user activities, left → right)
| Connect | Fetch Schema | Configure | Download | Report | Export |
|---|---|---|---|---|---|

## Release slices
### Release 1 — Walking skeleton
| <card IDs / titles> | … |

### Release 2 — Core features
| … |

## Gaps
- ⚠️ <activity> — no roadmap coverage for <journey step>

## Impact map (optional)
Goal: <from PRODUCT.md>
└─ Actor: <persona>
   └─ Impact: <behaviour change we need>
      └─ Deliverable: <card or feature>
```

### 4 — Report

```
✅ Story map → docs/story-map.md
🗂  Activities : <n>
📦 Cards mapped : <n> (<n> done, <n> open)
⚠️  Gaps        : <n> — see docs/story-map.md#gaps
➡️  Next        : /roadmap to add cards for the gaps
```
