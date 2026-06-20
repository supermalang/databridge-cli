# Product

## Register

product

## Users

Primarily **M&E (monitoring & evaluation) officers and field coordinators** at NGOs and
development/humanitarian organizations — a mix of moderate and low technical skill. They are
not data analysts or engineers. They work with Kobo/Ona survey data and need to turn it into
credible reports for programs and donors, often under deadline and sometimes in low-bandwidth
or field conditions.

The job to be done: **go from a survey schema to a finished, trustworthy `.docx` report
without needing an analyst** — configure extraction, filter and export submissions, and
generate reports with charts and editable narrative, self-serve.

## Product Purpose

databridge-cli (kobo-reporter) lets non-expert program staff do work that previously required
a data specialist. It fetches survey schemas, drives extraction / visualization / export
through a single guided configuration, downloads + filters + redacts submission data, and
generates Word reports with embedded charts and editable text.

Success looks like a **field coordinator or M&E officer completing the full pipeline
unaided** — and trusting the result. The product wins when the complexity of the underlying
data work (flattening repeat groups, PII redaction, chart selection, multi-period slicing) is
absorbed by the tool rather than pushed onto the user.

## Brand Personality

**Clear · neutral · institutional.** Understated and credible — the interface should look
legitimate to NGO, public-sector, and donor audiences and then get out of the way. Quiet
confidence over flash. The voice is plain-language and reassuring (these users handle
sensitive data and may be anxious about getting it wrong), never jargon-heavy or clever for
its own sake. It should feel like a serious, dependable instrument that a non-specialist can
operate without fear.

## Anti-references

- **Intimidating / engineer-only tools** — no raw-config-first, terminal-first, jargon-heavy
  surfaces that scare non-technical staff. The CLI/terminal exists, but the UI must never
  *require* it.
- **Consumer/playful SaaS** — no gradients-for-decoration, mascots, emoji-heavy or bubbly
  marketing-app aesthetics; they undercut institutional credibility.
- **Generic AI-template look** — no cream/sand backgrounds, no tracked-uppercase eyebrow above
  every section, no identical icon-heading-text card grids, no slop.

## Design Principles

1. **Guide, don't gate.** Lead non-experts through the pipeline one step at a time
   (progressive disclosure); never present the full surface of options at once. The six-tab
   flow mirrors the real workflow — keep it that legible.
2. **Plain language over jargon.** Labels, hints, and errors speak the user's words
   (program, report, period), not the implementation's (kobo_key, repeat group, query).
   Explain consequences, not internals.
3. **Make the safe path the default.** PII redaction, consent gating, and validation are
   on by default and visibly reassuring — safety is a feature the user can *see*, not a
   setting they must discover.
4. **Credible over clever.** Every visual choice should read as trustworthy to a donor
   audience. When in doubt, quieter and more legible wins.
5. **Respect the field.** Assume low-end devices, imperfect connectivity, and interruption.
   Fast, lean, recoverable beats rich-but-fragile.

## Accessibility & Inclusion

Target **WCAG 2.1 AA**, with explicit attention to **low-bandwidth and field conditions**:
low-end devices, poor connectivity, and intermittent use. Keyboard operability and
programmatic labeling are required (the current audit found a strong baseline — focus-visible
rings, `.sr-only`, reduced-motion — but real gaps in keyboard-operable controls and tab/ARIA
semantics). Favor lean assets and graceful degradation over heavy interactivity.
