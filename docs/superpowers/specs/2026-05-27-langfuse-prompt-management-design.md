# Langfuse Prompt Management Integration — Design

**Status:** Design approved 2026-05-27 — pending implementation plan
**Scope:** prompt management + LLM tracing + evaluations (Langfuse Cloud)

## Goal

Make Langfuse Cloud the single source of truth for the project's seven AI prompts so they can be edited, versioned, and rolled back from one UI — and capture every LLM call as a trace with cost, latency, and token usage for debugging and evaluation.

The seven AI features today: `narrator`, `summaries`, `chart_suggester`, `template_generator`, `classifier`, `summary_suggester`, `view_suggester` (see `src/utils/prompts.py` and the call sites in `src/reports/` plus `src/data/classifier.py`).

## Non-goals

- Self-hosted Langfuse (target is `cloud.langfuse.com`; host stays env-configurable so it's not painful to switch later).
- Multi-environment prompt labels (everything uses the `production` label in v1).
- Automated eval/scoring pipelines (Langfuse evals can be set up in the UI after v1).
- Pre-warming the prompt cache at startup (lazy fetch is fine for a CLI).
- Backwards compatibility for the old `prompts:` block in `config.yml` (deleted, not deprecated).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  src/reports/narrator.py, summaries.py, ai_chart_*.py,      │
│  ai_template_generator.py, data/classifier.py               │
│                                                             │
│  Each calls:                                                │
│    prompt = lf.get_prompt("narrator", variables={...})      │
│    response = lf.chat(prompt, model=cfg["ai"]["model"])     │
└──────────────────────┬──────────────────────────────────────┘
                       │
              ┌────────▼──────────────┐
              │ src/utils/lf_client.py│  ← new module, ~200 LOC
              │                       │
              │  - get_prompt(name)   │  fetch+compile, cache to disk
              │  - chat(...)          │  wraps OpenAI/Anthropic with
              │                       │   automatic Langfuse tracing
              │  - push_seed_prompts()│  bootstrap helper
              │  - flush()            │  drain trace queue on exit
              └────────┬──────────────┘
                       │
        ┌──────────────┼──────────────────┐
        ▼              ▼                  ▼
  Langfuse Cloud    Disk cache       OpenAI/Anthropic
  (prompts +       (~/.cache/         (existing config)
   traces +         databridge/
   evals)           prompts/*.json)
```

**One client module, three responsibilities:** prompt resolution (with cache + in-code fallback), traced LLM call, and a one-shot bootstrap command. All seven AI features migrate to a uniform call shape so the AI call-site files lose their hand-rolled f-string prompt-building.

## Components

### `src/utils/lf_client.py` (new)

Singleton-style client. Public surface:

| Method | Purpose |
|---|---|
| `get_prompt(name, variables, label="production")` | Fetch by name+label, compile `{{vars}}` → list of chat messages. On network error: read disk cache. On no cache: in-code seed. Cache TTL is 1h; older entries trigger a refetch on next call. |
| `chat(messages, model, trace_name, metadata)` | Calls OpenAI/Anthropic SDK wrapped by Langfuse's tracing decorator. Captures latency, token counts, cost (server-side), and the input/output to the trace. Returns the parsed response. |
| `push_seed_prompts(force=False)` | Iterates `SEED_PROMPTS` dict (7 entries), creates each in Langfuse only if it doesn't exist. `force=True` overwrites. |
| `flush()` | Drains the trace queue. Called at end of every CLI command via `atexit`. |
| `get_client()` | Module-level accessor returning the singleton; first call initialises from env vars. Returns a no-op client if `LANGFUSE_*` env vars are unset. |

### `src/utils/seed_prompts.py` (renamed from `src/utils/prompts.py`)

Holds `SEED_PROMPTS: dict[str, list[ChatMessage]]` with the existing in-code default prompts verbatim, restructured as chat-format `[{role, content}]` with `{{variable}}` placeholders where Python f-strings currently interpolate. No other functions — `system_prompt()`, `extra_instructions()`, `append_extra()` are deleted along with the `prompts:` block in `config.yml`.

### `src/data/make.py` — one new CLI command

```bash
python3 src/data/make.py push-prompts          # create-if-missing (idempotent)
python3 src/data/make.py push-prompts --force  # overwrite existing
```

Also added to `ALLOWED_COMMANDS` in `web/main.py` so the UI can trigger it.

### Migrations in existing AI call sites (7 files)

- `src/reports/narrator.py` (key `narrator`)
- `src/reports/summaries.py` (key `summaries`)
- `src/reports/ai_chart_suggester.py` (key `chart_suggester`)
- `src/reports/ai_template_generator.py` (key `template_generator`)
- `src/reports/ai_summary_suggester.py` (key `summary_suggester`)
- `src/reports/ai_view_suggester.py` (key `view_suggester`)
- `src/data/classifier.py` (keys `classifier_discover` + `classifier_classify` — see note below)

Each loses its hand-rolled prompt-building f-strings; instead it builds a `variables` dict and calls `lf.get_prompt(...)` + `lf.chat(...)`. The `from src.utils.prompts import system_prompt, append_extra` imports get deleted.

**Classifier is two prompts, not one.** `classifier.py` has two distinct system+user prompt pairs — theme *discovery* (`discover_themes`) and *classification* (`classify_responses`). The old code shared a single `classifier` override key for both system prompts but had separate in-code user templates. Since both system and user now live in Langfuse and the user templates differ, they become two Langfuse prompts: `classifier_discover` and `classifier_classify`. This makes `SEED_PROMPTS` hold **8** entries even though there are 7 feature files.

**Mustache vs `.format()` escaping.** Langfuse compiles prompts with `{{variable}}` (double-brace mustache). The current Python templates use single-brace `{var}` for `.format()` and escape literal JSON braces as `{{` / `}}` (e.g. classifier's `{{"themes": [...]}}`). When porting a template into a seed prompt: convert real `.format()` slots from `{var}` → `{{var}}`, and convert escaped literal braces `{{`/`}}` back to single `{`/`}`. This is a careful per-template edit, not a blind find/replace.

### `config.yml`

Loses its `prompts:` block. `sample.config.yml`, `README.md`, and `CLAUDE.md` updated to reflect the move.

### `.env.example` — new vars

```
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_HOST=https://cloud.langfuse.com   # default
```

### `requirements.txt`

Adds `langfuse` (Python SDK) — needed for prompt fetching, automatic LLM client wrappers, and trace ingestion.

## Data flow

### Cold start (first run after install)

1. User sets `LANGFUSE_*` env vars in `.env`.
2. User runs `python3 src/data/make.py push-prompts`.
3. Client iterates the 7 entries in `SEED_PROMPTS`, calls Langfuse API to create each as a chat prompt with label `production`. Skips ones that already exist.
4. From here on, prompt edits happen in the Langfuse UI — no code change required.

### Steady-state (every AI call)

1. CLI command starts. `lf_client.get_client()` initialises the singleton (reads env vars, opens HTTPS pool, registers `atexit` for `flush()`).
2. Feature code: `messages = lf.get_prompt("narrator", variables={"columns": [...], "stats": {...}})`.
3. Client checks in-memory cache → if miss, checks disk cache at `~/.cache/databridge/prompts/narrator-production.json` → if miss or stale (>1h), fetches from Langfuse and writes to disk.
4. Client compiles `{{variables}}` against the chat template → returns `[{role, content}, ...]`.
5. Feature code: `response = lf.chat(messages, model=cfg["ai"]["model"], trace_name="narrator")`.
6. Client wraps the LLM SDK call in a Langfuse generation span. Token usage and latency are captured automatically; cost is computed server-side from the model name.
7. On CLI command exit, `flush()` drains queued traces. ~200ms in normal case.

### Offline path

1. `get_prompt` finds disk cache → uses it (logs "using cached prompt").
2. Disk cache miss → falls back to `SEED_PROMPTS[name]` (logs warning).
3. `chat()` still calls the LLM provider (separate network); tracing calls swallow `ConnectionError` and queue the event to disk for retry on next online run. The LLM result is returned normally either way.

### Trace structure per CLI command

```
trace: build-report                          ← parent (command name)
├── generation: narrator                     ← LLM call, with cost/tokens
├── generation: summary:village_overview     ← one per dynamic summary
└── generation: chart_suggester              ← (if AI chart suggestion ran)
```

This gives per-command grouping in the Langfuse UI — useful because one `build-report` may make several AI calls.

## Error handling & fallback

| Failure | Behaviour | User-visible |
|---|---|---|
| Langfuse 5xx during prompt fetch | Use disk cache silently | nothing |
| Disk cache stale (>1h) AND network fails | Use stale cache, log INFO | one log line |
| No disk cache AND network fails | Use `SEED_PROMPTS[name]`, log WARNING | "Langfuse unreachable, using bundled prompt for `narrator`" |
| Prompt name not in Langfuse, not in seeds | Raise `LookupError` | command fails fast — this is a bug, not a transient |
| Variable missing during compile | Raise `KeyError` with the missing var name | command fails — programmer error, should surface |
| LLM provider error (OpenAI/Anthropic) | Existing behaviour preserved (each call site has its own try/except returning `""` or `{}`) | unchanged |
| Trace ingestion fails (network or 4xx) | Queue event to `~/.cache/databridge/traces/`, retry on next `flush()` | nothing; eventually consistent |
| `LANGFUSE_*` env vars unset | `get_client()` returns a no-op client. `get_prompt` always uses seeds; `chat` calls the LLM directly with no tracing | one INFO line at startup: "Langfuse not configured, prompts from bundled defaults" |
| Langfuse returns 401 | Log a single ERROR with "check `LANGFUSE_SECRET_KEY`" and fall back to seeds. Do not retry on 401 | one ERROR line |

**Two key principles:**

- **Tracing failures never fail the user's command.** Reports must build even if Langfuse is down.
- **Prompt-compile failures DO fail the command.** A `KeyError` on a missing template variable is a real bug; silently substituting empty strings would make AI output mysteriously bad.

## Testing strategy

### Unit tests — `tests/utils/test_lf_client.py` (new)

| Test | Asserts |
|---|---|
| `get_prompt` returns seed when no env vars set | Offline-by-default works |
| `get_prompt` uses disk cache when network mocked to raise | Cache fallback |
| `get_prompt` uses seed when no cache + network fails | Last-resort fallback |
| `get_prompt` raises `LookupError` for unknown name | Programmer-error path |
| `compile_prompt` raises `KeyError` on missing var | Mistakes surface |
| `chat()` returns LLM response when tracing fails | Tracing failure doesn't break commands |
| `push_seed_prompts()` skips existing prompts, creates missing | Idempotent bootstrap |
| `push_seed_prompts(force=True)` overwrites | Force flag works |

Network calls mocked with `unittest.mock` (`respx` is not a project dependency; do not add it).

### Integration test — `tests/integration/test_langfuse_smoke.py` (new, gated)

Runs only if `LANGFUSE_TEST_KEYS` env var is set (CI secret). Bootstraps a test project, pushes seeds, fetches one back, asserts round-trip. Skipped locally and in PRs from forks.

### Regression guard — `tests/test_build_report_smoke.py` (existing)

There are no dedicated unit tests for the seven AI features today; the only test that exercises them is `test_build_report_smoke.py`, which runs `build-report` with **no** `ai:` section so the narrator no-ops. The migration MUST preserve this no-op path: when `ai_cfg` is empty or the api_key is unresolved, the feature returns its empty/fallback value without contacting Langfuse or any LLM. This test must still pass unchanged after the migration.

### Manual verification checklist (PR description)

- [ ] `make.py push-prompts` on empty Langfuse project creates 7 prompts
- [ ] Re-running is idempotent (no duplicates)
- [ ] Edit a prompt in Langfuse UI, run `build-report`, output reflects the edit
- [ ] Unset `LANGFUSE_*` env vars, `build-report` still works (uses seeds)
- [ ] Set `LANGFUSE_HOST=http://nonexistent`, `build-report` still works (uses cache, then seeds)
- [ ] Run `build-report`, check Langfuse UI shows one trace with N generation children

## Open questions / deferred decisions

- **Eval automation.** Langfuse supports server-side evals and human-scoring datasets. v1 ships without code-side integration; users can wire evals via the UI. If the project grows toward automated eval-driven prompt iteration, revisit.
- **Multi-environment labels.** Hardcoded `production` for v1. If a dev/staging separation comes up (e.g., the user wants to try a draft prompt without affecting `build-report`), add a `LANGFUSE_LABEL` env var.
- **Cache TTL.** 1h is a placeholder. Tune based on how often the user actually edits prompts.

## References

- [Langfuse Python SDK docs](https://langfuse.com/docs/sdk/python)
- [Langfuse Prompt Management](https://langfuse.com/docs/prompts/get-started)
- Existing prompt resolution: `src/utils/prompts.py`
- Five AI call sites: `src/reports/narrator.py`, `src/reports/summaries.py`, `src/reports/ai_chart_suggester.py`, `src/reports/ai_template_generator.py`, `src/data/classifier.py`
