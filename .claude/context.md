# context.md — databridge-cli (kobo-reporter)

Tier-1 operational guide. Agents read this on every run for concrete project facts.
Deeper prose lives in `CLAUDE.md`; product vision in `PRODUCT.md`; visual design in `DESIGN.md`.
A fact belongs in exactly one place — don't duplicate across tiers.

---

## Project

**Name:** databridge-cli (kobo-reporter)
**Description:** CLI + web tool that fetches Kobo/Ona survey schemas, processes submissions,
and generates Word reports with embedded charts for M&E teams in development/humanitarian settings.
**Users:** M&E officers + field coordinators (mixed/low technical skill — self-serve is the goal).
**Compliance:** WCAG 2.1 AA; field-bandwidth-aware; no PII in logs or responses.

---

## Tech stack

| Layer | Technology |
|---|---|
| Data / CLI | Python 3.11 · pandas · matplotlib · docxtpl · click |
| API | FastAPI · uvicorn · SQLAlchemy 2.0 · Alembic |
| Database | PostgreSQL (prod) · SQLite (tests) |
| Storage | Minio / S3 |
| Auth | Zitadel (OIDC) |
| AI / prompts | OpenAI + Anthropic · Langfuse |
| Frontend | React + Vite (JSX) · no TypeScript |
| Testing (Python) | pytest · PYTHONPATH=. MPLBACKEND=Agg |
| Testing (UI) | Playwright · toHaveScreenshot · 3 viewports (Tier 1 dedicated visual suite `visual-review/specs/` + Tier 2 Storybook component isolation `visual-review/storybook/`) · Tier 3 human review app `visual-review/review-app/` |
| VCS | Git-flow: feature/* off develop → PR → develop → main |

---

## Commands

```bash
# Dev
./scripts/dev.sh            # uvicorn :8000 + Vite HMR :51730

# Tests
PYTHONPATH=. MPLBACKEND=Agg python -m pytest -q          # full Python suite
PYTHONPATH=. MPLBACKEND=Agg python -m pytest <file>      # single file
cd frontend && npm run test:e2e                           # Playwright visual suite
cd frontend && npm run test:e2e:update                   # regenerate baselines

# Lint / type-check (no strict TS — JSX only)
cd frontend && npm run lint

# CLI
python3 src/data/make.py <command>   # fetch-questions | download | build-report | run-all …
```

---

## Version control

Platform: **GitHub**. PRs via `gh pr create --base develop`. Auth: `GH_TOKEN` or `gh auth login`.
Branch convention: `feature/<slug>` | `fix/<slug>` | `chore/<slug>` off `develop`.
Never commit directly to `main` or `develop`.

---

## Absolute rules (non-negotiable — blockers if violated)

1. **Tenant isolation** — every DB query is membership-scoped (org → project → membership).
   No cross-project read or write.
2. **PII fail-closed** — `enforce_pii` in `src/utils/pii.py` must abort on misconfig; never
   silently pass raw data. `--no-redact` is CLI-only.
3. **Secrets via `env:` only** — no token/key literals in config, code, or API responses.
4. **Command whitelist** — only `ALLOWED_COMMANDS` runnable via `/api/run/*`; no arbitrary shell.
5. **Run isolation** — each `/api/run/{cmd}` runs in its own tempdir (`hydrate_run_dir`).
6. **No raw-SQL interpolation** — SQLAlchemy 2.0 parameterized queries only.

---

## Brand tokens (for /report)

| Token | Value |
|---|---|
| Logo | `docs/assets/logo.png` (create if absent) |
| Primary accent | `#0F766E` (Deep Field Teal) |
| Background | `#F8FAFC` (cool-slate 50) |
| Surface | `#FFFFFF` |
| Text primary | `#0F172A` |
| Text muted | `#64748B` |
| Body font | Inter (system stack: `Inter, -apple-system, sans-serif`) |
| Mono font | JetBrains Mono |
| Org name | LDB / databridge |
| Report output dir | `docs/reports/` |
| Deck output dir | `out/` (gitignored) |

Image generation (illustrated style — opt-in):
- Provider: kie.ai
- API key env var: `KIE_API_KEY`
- Script: `.claude/reporting/generate-image.mjs`
- Models: set via `KIE_MODEL_T2I` / `KIE_MODEL_I2I` (defaults to `google/nano-banana` / `google/nano-banana-edit`)

---

## Generated files & artifacts

Three buckets — facts belong in only one; agents must not commit throwaway files.

| Bucket | Where | Git | Examples |
|---|---|---|---|
| **Knowledge** | `docs/` | ✅ committed | ARCHITECTURE.md, retros, story maps, usability reports |
| Visual approval ledger | `visual-review/visual-approvals.json` | ✅ committed | who approved/rejected which baseline PNG, when, for which task — written only by a human via `visual-review/review-app/`; read by `/visual-review` |
| Roadmap archive | `docs/roadmap/archive/<area-slug>.md` | ✅ committed | full bodies of delivered cards swept out of `docs/ROADMAP.md` by `/roadmap-status archive` (lossless; git also holds them) — keeps the live roadmap proportional to active work |
| **Non-reproducible deliverables** | `docs/reports/` · `docs/reports/assets/` | ✅ committed | Branded markdown reports, deck images |
| **Regenerable outputs** | `out/` · `data/processed/` · `reports/` | ❌ gitignored | PPTX decks, chart PNGs, built .docx |
| **Throwaway verification** | `.scratch/` | ❌ gitignored | UAT screenshots (`.scratch/uat/`), perf snapshots, debug dumps |

Rule: if a file can be regenerated from source + config, it is ignored. If a human needs
to review or approve it before it's meaningful, it is throwaway until approved, then
committed to `docs/`.

---

## SCA commands (for dep-audit)

```bash
pip-audit -r requirements.txt -r requirements-dev.txt --format json   # Python tree
cd frontend && npm audit --json                                         # JS tree
```
