# Project output language — archived (delivered) cards

> Full history also in git. Live roadmap keeps only the ledger row.

- [x] **PLANG-3 — Generate AI output (narrative, summaries, suggestions, Ask) in the project language**

  **Created:** 2026-06-26 · **Completed:** 2026-06-26

  With PLANG-1 feeding the project language into `config.ai.language`, ensure **every** AI generation
  site honours it so generated text comes out in the project language (per the confirmed scope —
  **AI-generated text only**; user-typed chart/indicator titles and question-derived axis labels render
  as entered). The narrator already reads `ai.language` (`src/reports/narrator.py` ~83) and AI
  summaries do too (`src/reports/summaries.py` ~268); extend the sites that currently ignore it: the
  Ask engine caption/proposal prompts (`src/reports/ask_engine.py` ~189–206/422–442) and the AI
  suggesters (`src/reports/ai_chart_suggester.py` and the other `ai_*_suggester.py` / template
  inference) so their LLM prompts include the output-language instruction. Add a regression test that
  each generation site passes the configured language into its prompt variables. **Depends on PLANG-1.**

  **Files:** `src/reports/ask_engine.py` (thread language from `ai_cfg` into the propose / refine /
  caption prompt variables) · `src/reports/ai_chart_suggester.py` + the other
  `src/reports/ai_*_suggester.py` (+ template inference) that omit language (add the language prompt
  var) · `src/reports/summaries.py` (the keyword-frequency stop-word language ~152 — derive from
  `ai.language` rather than a hardcoded default where a sensible mapping exists) ·
  `tests/test_generation_language.py` (new)

  **Config/schema impact:** None — reads the existing `ai.language` (now fed by the project language via
  PLANG-1).

  **Acceptance criteria**
  - Narrator, AI summaries, the Ask engine (captions / proposals), and the AI suggesters (chart /
    indicator / etc.) each include the configured `ai.language` as the output-language instruction in
    their LLM prompt variables
  - Given `ai.language = "French"`, each site's prompt carries the French language instruction (provable
    by capturing the prompt variables / mocking the LLM) — no site silently emits in a hardcoded language
  - The keyword-frequency summary stop-word language follows `ai.language` (mapped to its code) rather
    than a hardcoded default where a mapping exists; an unknown/unsupported language degrades gracefully
    (no crash)
  - User-authored chart/indicator titles + question-derived axis labels are **unchanged** (the confirmed
    scope excludes translating user-typed strings) — only AI-generated text is language-driven
  - AI features remain no-ops when no AI key is configured (no regression to the offline / seed path)

  **Unit tests:** `tests/test_generation_language.py` — for the narrator, AI summaries, the Ask engine,
  and at least one suggester: set `ai.language="French"`, mock/capture the LLM call, and assert the
  language value reaches the prompt variables; assert a missing/empty `ai.language` defaults
  deterministically to English; assert the no-AI-key path no-ops without error. Uses the suite's existing
  fakes — no live LLM call.

  **E2E:** N/A (no UI surface — generation pipeline; it consumes the config produced by PLANG-1/PLANG-2,
  whose UI is covered there).

  **UAT:** N/A (back-end generation, no UI surface of its own — verified via the Verify command, the unit
  tests, the verifier, and PR review; UAT moves in lockstep with E2E).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_generation_language.py`

---

- [x] **PLANG-2 — Create-only language field + read-only language in AI config (UI)**

  **Created:** 2026-06-26 · **Completed:** 2026-06-26

  With PLANG-1 making the project language immutable + authoritative, reflect that in the UI. In
  `ProjectForm` the language `<select>` (`frontend/src/pages/ProjectForm.jsx` ~11/50/188–191) is
  editable only when **creating** a project; in **edit** mode it is shown read-only/disabled with a
  one-line note that it is fixed at creation. In the AI-config tab
  (`frontend/src/pages/Sources.jsx` section="ai") the language stops being an editable input and
  instead shows the **project's** language read-only, with a hint that it is set on the project and
  governs generated output. New strings land in EN + FR (parity enforced). **Depends on PLANG-1.**

  **Files:** `frontend/src/pages/ProjectForm.jsx` (language field editable on create, read-only /
  disabled + helper note on edit; keep dirty-tracking correct for the now-immutable field
  ~50/69–75/188–191) · `frontend/src/pages/Sources.jsx` (AI section: replace the editable language
  control with a read-only display sourced from the active project's language + hint) ·
  `frontend/src/lib/projects.js` (only if the active project's language is not already available to
  the AI-config view) · `frontend/src/locales/{en,fr}.json` (read-only hints / labels) ·
  `frontend/tests/e2e/project-language.spec.ts` (new)

  **Config/schema impact:** None — UI only (PLANG-1 owns persistence + mirroring).

  **Acceptance criteria**
  - In the **create** project form the language selector is editable (English/French/Spanish/
    Portuguese/Arabic) and its value is submitted on create
  - In the **edit** project form the language is shown read-only / disabled with a visible one-line
    note that it is set at creation and cannot be changed; the form's dirty-tracking does not flag
    the unchanged read-only language
  - The AI-config tab no longer presents language as an editable input; it displays the active
    project's language as a read-only value with a hint that it is the project's language and drives
    generated output
  - The read-only AI-config language **matches** the project's language
  - All new strings exist in both `en.json` and `fr.json` (key-aligned, `check:i18n` passes); the
    controls are keyboard-accessible with accessible names and a visible focus ring
  - Impeccable audit/critique clean

  **Unit tests:** N/A (frontend-only; Vitest is not installed — the create-vs-edit field state, the
  read-only AI-config display, and i18n parity are asserted by the Playwright E2E below + `check:i18n`,
  per the i18n/PUX precedent).

  **E2E:** `frontend/tests/e2e/project-language.spec.ts` (new) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — in the create form assert the language `<select>` is enabled and selectable; in
  the edit form assert the language control is disabled / read-only and the fixed-at-creation note is
  shown; on the AI-config tab assert the language renders read-only matching the project's language with
  no editable input. Run a Playwright axe audit on both surfaces and assert no new violations. Capture
  `toHaveScreenshot` baselines of the edit-mode read-only language field and the AI-config read-only
  language at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900); a human approves.

  **UAT:**
  1. Create a new project, choose **French** as the language, and save. Reopen the project's edit form
     and confirm the language is shown but cannot be changed, with a note explaining it is fixed at
     creation.
  2. Open Extract → AI configuration and confirm the language is shown read-only as "French" with a
     hint that it is the project's language.
  3. Switch your **interface** (profile) language to English and confirm the **project** language stays
     French (the two are independent).

  **Verify:** `cd frontend && npx playwright test project-language.spec.ts && npm run check:i18n`

---

- [x] **PLANG-1 — Project language is set once at creation and drives the AI output language (backend + config mirroring)**

  **Created:** 2026-06-26 · **Completed:** 2026-06-26

  `project.meta.language` already exists (offered in `ProjectForm` as
  English/French/Spanish/Portuguese/Arabic) but (a) it is **editable post-creation** via
  `PATCH /api/projects/{id}` (`web/main.py` ~278–284; `_META_KEYS` includes `language`;
  `repository.update_project` ~177–191 merges meta), and (b) it **never reaches the generation
  pipeline** — `project.meta` is not mirrored to `config.yml`, so generation reads the separate,
  independently-editable `ai.language` (`sample.config.yml` ~540; `narrator.py` ~83;
  `summaries.py` ~268). Make the project language **immutable after creation** and the **single
  source of truth** for the AI output language by injecting it into `config.ai.language` whenever
  the config is materialized for the CLI. **Backend / data only** — the form + AI-config UI are
  PLANG-2; threading the language into each generation site is PLANG-3.

  **Files:** `web/main.py` (create still accepts `language`; the PATCH path must **not** change it —
  drop `language` from the patch meta merge / reject attempts, ~222–284) · `web/db/repository.py`
  (`update_project` preserves an existing `meta.language`, ~177–191) · `web/db/bridge.py`
  (`materialize_config` / `mirror_active` set `cfg["ai"]["language"]` from `project.meta.language`
  with a legacy default, ~11–24) · `tests/test_project_language.py` (new) · `tests/test_bridge.py`
  (reconcile the existing `materialize_config` round-trip assertion to the injected `ai.language`)

  **Config/schema impact:** No new DB column (lives in the existing `meta` JSONB). `config.ai.language`
  becomes a **derived** mirror of the project language at materialize time — a manually-edited
  `ai.language` is overwritten from the project on the next materialize.

  **Acceptance criteria**
  - A project's `language` is accepted at creation (`POST /api/projects`) and stored in
    `project.meta.language`
  - After creation the language is **immutable**: `PATCH /api/projects/{id}` does not change
    `meta.language` (an attempt is ignored or rejected, still membership-scoped as today) and
    `update_project` preserves the existing value
  - When the active project's config is materialized to `config.yml`, `ai.language` is set from
    `project.meta.language`, so the CLI + generation pipeline use the project language regardless of
    any value previously stored in `ai.language`
  - A **legacy** project with no `meta.language` falls back to its existing `config.ai.language` if
    present, else `"English"` (deterministic default, no crash)
  - Per-project isolation preserved: one project's language never appears in another's materialized
    config

  **Unit tests:** `tests/test_project_language.py` — (1) `test_create_persists_language`: create stores
  `meta.language`. (2) `test_language_immutable_on_patch`: a PATCH attempting to change the language
  leaves `meta.language` unchanged. (3) `test_materialize_injects_project_language`: `materialize_config`
  sets `ai.language` from the project, overriding a stale `ai.language` already in the config. (4)
  `test_legacy_default`: a project with no `meta.language` materializes the existing `ai.language` if
  present, else `"English"`. (5) `test_per_project_isolation`: two projects materialize their own
  languages independently. Uses the suite's SQLite + local-storage self-provisioning.

  **E2E:** N/A (no UI surface — backend immutability + config mirroring; the form / AI-config UI is
  PLANG-2 and is covered there).

  **UAT:** N/A (back-end change, no UI surface of its own — verified via the Verify command, the unit
  tests, the verifier, and PR review; UAT moves in lockstep with E2E).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_project_language.py`

---

