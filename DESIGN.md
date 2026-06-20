---
name: databridge-cli (kobo-reporter)
description: A clear, institutional workbench that turns survey data into trustworthy reports.
colors:
  deep-field-teal: "#0F766E"
  field-teal-deep: "#115E59"
  field-teal-soft: "#CCFBF1"
  field-teal-ink: "#134E4A"
  ink: "#0B1220"
  ink-2: "#2A3447"
  ink-3: "#5A6473"
  muted: "#6B7686"
  surface: "#FFFFFF"
  surface-2: "#FAFBFD"
  bg: "#F5F7FA"
  bg-2: "#EEF1F6"
  border: "#E5E8ED"
  border-2: "#D6DBE3"
  border-strong: "#B6BFCD"
  success-green: "#16A34A"
  success-green-soft: "#DCFCE7"
  caution-amber: "#D97706"
  caution-amber-soft: "#FEF3C7"
  gold: "#B45309"
  danger-rose: "#DC2626"
  danger-rose-soft: "#FEE2E2"
  violet: "#7C3AED"
  slate-dark: "#0B1220"
  slate-dark-2: "#111A2E"
typography:
  display:
    fontFamily: "Inter, Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.028em"
  headline:
    fontFamily: "Inter, Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter, Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "15.5px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "10.5px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.1em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "14px"
  lg: "20px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.deep-field-teal}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "34px"
  button-primary-hover:
    backgroundColor: "{colors.field-teal-deep}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "34px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "20px 22px"
  chip:
    backgroundColor: "{colors.field-teal-soft}"
    textColor: "{colors.field-teal-ink}"
    rounded: "999px"
    padding: "2px 10px"
---

# Design System: databridge-cli (kobo-reporter)

## 1. Overview

**Creative North Star: "The Clear Workbench"**

This is a workbench, not a showcase. A field coordinator or M&E officer arrives with a
survey and a deadline, and the interface lays the complex pipeline — fetch, configure,
download, compose, report — out flat and legible, one step at a time. Every surface earns its
place by helping someone who is *not* a data analyst do an analyst's job and trust the result.
The aesthetic is cool, calm, and institutional: a serious instrument that a non-specialist can
operate without fear.

The system is built on a cool-slate neutral foundation (`#F5F7FA` page, `#FFFFFF` surfaces)
with a single committed accent — **Deep Field Teal** (`#0F766E`) — that carries every primary
action, active state, and focus ring. Restraint is the strategy: color is rationed so that
when teal appears, it *means* something (this is the action, this is selected, this is where
focus is). Structure comes from hairline borders and generous spacing rather than shadows or
fills. Monospace (JetBrains Mono) is used deliberately for machine-truth — keys, tokens, IDs,
counts, log output — so the eye learns that mono = "this is literal data," sans = "this is for
you to read."

It explicitly rejects three things. It is **not an engineer-only tool**: no raw-config-first,
terminal-forward, jargon-heavy surface that scares non-technical staff (the terminal exists,
docked and optional, never required). It is **not consumer/playful SaaS**: no decorative
gradients, no mascots, no emoji-bubbly marketing aesthetic that would undercut donor
credibility. And it is **not generic AI-template slop**: no cream/sand backgrounds, no
tracked-uppercase eyebrow above every section, no identical icon-heading-text card grids.

**Key Characteristics:**
- Cool-slate neutrals + one rationed teal accent (committed-restrained strategy)
- Flat by default; 1px borders and spacing carry structure, shadows respond to state
- Sans for prose, mono for machine-truth (keys, tokens, counts, logs)
- Pill badges and soft-tinted status colors (teal / green / amber / rose / violet)
- Quiet, precise, institutional — credibility over flourish

## 2. Colors

A cool, professional palette: slate-blue neutrals, one deep-teal voice, and a small set of
soft-tinted semantic status colors.

### Primary
- **Deep Field Teal** (`#0F766E`): The single brand voice. Primary buttons, active-tab
  underline and label, focus rings (as `#CCFBF1` glow), selected states, links, and the
  header bar. This is the only saturated color allowed to carry an action.
- **Field Teal Deep** (`#115E59`): The pressed/hover partner for Deep Field Teal — primary
  button hover, active-tab hairline.
- **Field Teal Soft** (`#CCFBF1`) / **Field Teal Ink** (`#134E4A`): The soft fill + readable
  ink pairing for teal chips, type badges, focus-ring glow, and selected menu rows.

### Secondary (semantic status, not decoration)
- **Success Green** (`#16A34A`, soft `#DCFCE7`): Confirmed / valid / active project / "used"
  states.
- **Caution Amber** (`#D97706`, soft `#FEF3C7`): Running, unsaved-changes, warnings, tips.
- **Gold** (`#B45309`): The readable ink for amber-soft fills (warning text on `#FEF3C7`).
- **Danger Rose** (`#DC2626`, soft `#FEE2E2`): Destructive actions, errors, PII flags.
- **Violet** (`#7C3AED`, soft `#F3E8FF`): Geographical category tags and one accent tone.

### Neutral
- **Ink** (`#0B1220`): Primary text, headings; also the terminal/dark-surface base.
- **Ink-2** (`#2A3447`): Secondary body text, form labels.
- **Ink-3** (`#5A6473`) / **Muted** (`#6B7686`): Tertiary text, hints, metadata, placeholders.
- **Surface** (`#FFFFFF`) / **Surface-2** (`#FAFBFD`): Card and panel backgrounds.
- **BG** (`#F5F7FA`) / **BG-2** (`#EEF1F6`): App canvas and inset/hover fills.
- **Border** (`#E5E8ED`) / **Border-2** (`#D6DBE3`) / **Border-strong** (`#B6BFCD`): The
  hairline structure system — divider, input stroke, and hover/emphasis respectively.
- **Slate Dark** (`#0B1220`) / **Slate Dark-2** (`#111A2E`): Terminal and log surfaces, the
  one place the UI goes dark.

### Named Rules
**The One Voice Rule.** Deep Field Teal is the only saturated color permitted to signify an
action or selection. If a screen has more than one teal "primary," one of them is lying. Status
colors (green/amber/rose/violet) report state; they never compete for "click me."

**The Mono-Means-Literal Rule.** JetBrains Mono is reserved for machine-truth — kobo keys,
placeholder tokens, IDs, counts, file sizes, log lines. Never set human-facing prose in mono to
look "technical." If a user is meant to *read* it as language, it's sans.

## 3. Typography

**Display / Body Font:** Inter (with Plus Jakarta Sans, system-ui fallback)
**Label / Mono Font:** JetBrains Mono (with ui-monospace, Menlo fallback)

**Character:** A single humanist-sans family doing almost all the work, paired on a true
contrast axis with a precise monospace. The sans is warm enough to feel approachable for
non-experts but neutral enough to read as institutional; the mono is the "data voice."
`font-feature-settings: "ss01","cv11"` is on globally for Inter's more legible alternates.

### Hierarchy
- **Display** (800, 32px, 1.1, `-0.028em`): Page greetings / hero titles. Accent word set in
  teal via `em`. The ceiling — the UI never shouts louder than this.
- **Headline** (700, 26px, 1.15, `-0.02em`): Workflow-landing (Home) title.
- **Title** (700, 14–15.5px, 1.2, `-0.01em`): Card and form-section titles. Most "headings" in
  this app live at this quiet, functional size.
- **Body** (400, 14px, 1.5): Default reading text. Sub/description text caps at ~64ch
  (`.page-sub`) to stay readable.
- **Label** (500, 10.5px, `0.1em`, UPPERCASE, mono): Eyebrows, rail-card titles, table headers,
  status pills. The one place uppercase tracking is allowed — and only as a structural label,
  never as decoration above every section.

### Named Rules
**The Quiet-Heading Rule.** Headings earn size by importance, not by reflex. Card titles sit at
14–15.5px; only true page-level titles reach Display. A wall of large bold headings is forbidden.

## 4. Elevation

Flat by default. Surfaces rest on the canvas defined by a 1px border and spacing; depth is a
*response to state*, not an ambient decoration. Two near-invisible shadow tokens exist, and they
are intentionally faint — the heavier of the two appears only on hover/lift. The terminal and
log panels are the exception: they use a slightly stronger shadow to read as a distinct,
docked dark surface.

### Shadow Vocabulary
- **Rest** (`box-shadow: 0 1px 0 rgba(11,18,32,.04), 0 1px 2px rgba(11,18,32,.04)`): The
  default card resting shadow — barely there; the border does the real work.
- **Lift** (`box-shadow: 0 1px 0 rgba(11,18,32,.04), 0 4px 14px rgba(11,18,32,.06)`): Hover /
  interactive-card / docked-terminal state.
- **Overlay** (`box-shadow: 0 20px 50px rgba(11,18,32,.18), 0 4px 12px rgba(11,18,32,.08)`):
  Modals and dropdown menus only — the one true "floating above everything" treatment.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest with a 1px border. A shadow that isn't
responding to hover, focus, or a true overlay (modal/menu) is forbidden. If depth is needed to
separate two resting surfaces, change the background tint or add a border — not a shadow.

## 5. Components

### Buttons
- **Shape:** Gently rounded (8px, `rounded.md`), 34px tall; small variant 28px.
- **Primary:** Deep Field Teal fill, white text, faint shadow; hover → Field Teal Deep.
- **Secondary (default `.btn`):** White surface, `border-2` stroke, ink text; hover → `bg-2`
  fill + `border-strong`. Active nudges down 0.5px (the only "tactile" motion).
- **Ghost / Danger:** Ghost is transparent with ink-2 text; Danger uses rose-soft fill with
  rose text (never a solid red fill except on hover).
- **Hover / Focus:** 0.12s color/border transitions; `:focus-visible` shows a 2px teal ring
  (white ring on the teal header). Disabled drops to 0.5 opacity.

### Chips / Badges
- **Style:** Fully rounded (999px) pills. Category/type badges use the soft-fill + matching-ink
  pairing per semantic role (teal/green/gold/violet/amber). Mono for type/count badges, sans
  for status badges.
- **State:** Selected chip-tabs lift onto a white surface with a faint shadow inside a `bg-2`
  track.

### Cards / Containers
- **Corner Style:** 12px (`rounded.lg`).
- **Background:** White (`surface`); insets/previews use `bg-2`.
- **Shadow Strategy:** Rest shadow at idle, Lift on hover (see Elevation). Never nest a card in
  a card — use a bordered row or a tinted inset instead.
- **Border:** 1px `border`; hover emphasis → `border-strong`.
- **Internal Padding:** 16–22px.

### Inputs / Fields
- **Style:** White surface, 1px `border-2` stroke, 7–8px radius, 36px tall. Custom mono SVG
  chevron on selects.
- **Focus:** Border shifts to Deep Field Teal + a 3px `field-teal-soft` glow ring — the single
  consistent focus signature across every input, token field, combobox, and slider.
- **Error / Disabled:** Duplicate/error inputs take a rose border on white; dirty inputs take an
  amber border on amber-soft. Disabled → 0.45 opacity on a `bg-2` fill.

### Navigation
- **Style:** A horizontal tab strip on the app canvas; active tab is teal text + teal 2px
  bottom border, with a small mono step-number badge. Sub-tabs are a quieter strip on `bg-2`.
- **States:** Idle ink-2 → hover ink → active teal. On narrow screens the bar scrolls
  horizontally (`overflow-x:auto`) rather than wrapping or collapsing.

### Docked Terminal (signature component)
A bottom-sticky, collapsible dark console (`slate-dark`) that streams CLI/SSE log output with
time · level · message columns and color-coded levels. It is *present but subordinate* —
collapsed to a 42px bar by default — embodying "the CLI is available, never required."

## 6. Do's and Don'ts

### Do:
- **Do** keep Deep Field Teal (`#0F766E`) as the only action/selection color — honor **The One
  Voice Rule**.
- **Do** carry structure with 1px borders (`#E5E8ED` / `#D6DBE3` / `#B6BFCD`) and spacing;
  reserve shadows for hover, focus, and true overlays (**The Flat-By-Default Rule**).
- **Do** use JetBrains Mono only for machine-truth (keys, tokens, counts, logs) and Inter for
  everything a human reads (**The Mono-Means-Literal Rule**).
- **Do** give every interactive control the teal focus ring (`box-shadow: 0 0 0 3px #CCFBF1`)
  and a real `<button>` / labeled `<input>` — non-experts and keyboard users depend on it.
- **Do** write labels, hints, and errors in plain language (program, report, period), not
  implementation terms (kobo_key, repeat group, query).
- **Do** keep status colors soft-filled with matching ink (green/amber/rose/violet) so they
  report state without competing for attention.

### Don't:
- **Don't** build an engineer-only feel — no raw-config-first, terminal-forward, jargon-heavy
  surface. The terminal stays docked and optional, never required.
- **Don't** drift into consumer/playful SaaS — no decorative gradients, mascots, or emoji-bubbly
  styling that undercuts donor credibility. (The two warm "tips-card" gradients are the lone
  legacy exception and should be flattened, not multiplied.)
- **Don't** ship generic AI-template slop: no cream/sand backgrounds, no tracked-uppercase
  eyebrow above every section (uppercase is for structural labels only), no identical
  icon-heading-text card grids.
- **Don't** nest a card inside a card; use a bordered row or a tinted inset.
- **Don't** use `border-left`/`border-right` > 1px as a colored accent stripe; if emphasis is
  needed, use a full border, a background tint, or a leading icon.
- **Don't** introduce a second saturated "primary." If a screen reads as having two teals, one
  is wrong.
- **Don't** add ambient shadows to separate resting surfaces — change the tint or add a border.
