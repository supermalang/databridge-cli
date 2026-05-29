# Prompt Output Schemas — Design

**Status:** Design approved 2026-05-29 — pending implementation plan
**Scope:** Attach a JSON Schema to each JSON-returning Langfuse prompt, fetch it with the prompt, and enforce it at the LLM call (OpenAI Structured Outputs / Anthropic tool-use).
**Builds on:** [2026-05-27-langfuse-prompt-management-design](./2026-05-27-langfuse-prompt-management-design.md)

## Goal

Today each JSON-producing prompt ends with an *instruction* like "Return ONLY a JSON object with keys X, Y, Z." The model usually obeys but can drift (extra keys, missing keys, markdown fences, hallucinated structure). Our parsers recover most of the time; when they don't, the feature returns empty output.

This change makes the contract **mechanical** instead of advisory: each prompt carries a JSON Schema that the LLM is *forced* to comply with at call time (OpenAI Structured Outputs; Anthropic tool-use with `input_schema`). Drift becomes impossible at the API boundary, so the parsers stop being a last line of defense.

## Non-goals

- Schemas for `summaries` (plain-text output — explicitly out of scope).
- Schemas for any future provider beyond OpenAI and Anthropic.
- Server-side schema validation in Langfuse (Langfuse stores schemas as opaque `config`; only our code enforces them).
- Custom JSON Schema validators in our code (we rely on provider-side enforcement, plus a meta-schema check on our own seeds at test time).

## Architecture

```
src/utils/seed_prompts.py
  Each entry becomes:
    { "messages": [...],
      "config":   { "output_schema": {...JSON Schema...} } }     ← new
  7 schemas total (one per JSON-returning prompt). `summaries` stays
  messages-only.

src/utils/lf_client.py
  get_prompt(name, variables) -> (messages, config)              ← was: messages
  chat(messages, *, output_schema=None, ...)                     ← new kwarg
    provider=openai  + schema  -> response_format = json_schema (strict=True)
    provider=anthropic + schema -> tools=[{ name, input_schema=schema }]
                                   + tool_choice forced to that tool
                                   + read tool_use.input as the JSON output
    no schema                   -> today's behavior (json_object / plain)
  push_seed_prompts(...)
    create_prompt(..., config=seed["config"])                    ← passes config

7 feature files (narrator, chart_suggester, template_generator,
  summary_suggester, view_suggester, classifier_discover, classifier_classify):
  messages, config = lf_client.get_prompt(name, vars)
  raw = lf_client.chat(..., output_schema=config.get("output_schema"))
  (existing _parse_* helpers stay; they become a defence-in-depth layer.)
```

## Components

### `src/utils/seed_prompts.py`

The `SEED_PROMPTS` dict's value type changes from `list[ChatMessage]` to a small dict:

```python
ChatMessages = List[Dict[str, str]]
SeedPrompt = TypedDict("SeedPrompt", {
    "messages": ChatMessages,
    "config":   Dict[str, Any],   # may contain "output_schema" or other keys; never None
})
```

Backward-compat for tests/callers that did `SEED_PROMPTS[name][0]` (indexing the messages directly) is **broken** intentionally — there were no public consumers of that shape outside this module. The internal seed-prompts test will be updated.

`summaries` is stored as `{"messages": [...], "config": {}}` (no schema).

### Schemas (sketch — full JSON in the implementation plan)

All 7 schemas use draft-2020-12. To stay compatible with OpenAI Strict mode:

- Every object sets `additionalProperties: false`.
- Every property listed under `properties` is also listed under `required` (Strict mode demands a closed contract; "optional" fields are modeled as `"type": ["string", "null"]`).
- No `oneOf`/`anyOf`/`allOf` at the top level. Use `enum` for finite sets.

| Prompt | Top-level shape |
|---|---|
| `narrator` | `{ summary_text: string, observations: string, recommendations: string }` (all required) |
| `chart_suggester` | `{ charts: [{ name, title, type, questions, options? }] }` — `type` is an enum of the 21 chart types from `CHART_DISPATCH`; `options` is a permissive object (we don't constrain it strictly because chart options vary widely) |
| `template_generator` | `{ sections: [{ heading, level: 1|2, content: [<item>] }] }` where `<item>` is one of 7 typed shapes (text, chart, indicator, summary, editable, divider, stats_table) modeled as an enum-discriminated object with `additionalProperties: false` per branch |
| `summary_suggester` | `{ summaries: [{ name, stat, questions, ... }] }` — `stat` enum: `distribution \| stats \| crosstab \| trend \| data_quality \| keyword_frequency \| correlation \| grouped_agg \| ai` |
| `view_suggester` | `{ views: [{ name, source, join_parent?, group_by?, question?, agg? }] }` — `agg` enum: `sum \| mean \| count \| max \| min` |
| `classifier_discover` | `{ themes: [string] }` (bounded length: `minItems: 1`, `maxItems: 20`) |
| `classifier_classify` | `{ classifications: { <response_text>: <theme_name> } }` — `additionalProperties: { type: "string" }` and `properties: {}` (this is the one place where `additionalProperties: false` does NOT apply — the value is an open map by design) |

The `classifier_classify` schema is the one exception to the closed-object rule. OpenAI Strict allows this (additionalProperties as a schema, not `false`, is permitted on a map-typed object); we explicitly mark it in the seed with a comment.

### `src/utils/lf_client.py`

Public API delta:

```python
# was:
def get_prompt(name, variables, label="production") -> ChatMessages

# now:
def get_prompt(name, variables, label="production") -> Tuple[ChatMessages, Dict[str, Any]]
```

```python
# was:
def chat(messages, *, model, provider, api_key, max_tokens, trace_name,
         base_url=None, json_mode=False) -> str

# now (adds output_schema; json_mode is kept for the no-schema path):
def chat(messages, *, model, provider, api_key, max_tokens, trace_name,
         base_url=None, json_mode=False, output_schema=None) -> str
```

Internal:

- `_resolve_raw(name, label)` already returns the chat-template messages from cache/Langfuse/seed; extend to also return the config dict (cache, seed, and Langfuse all already carry it — Langfuse's `ChatPromptClient` has a `config` instance attribute).
- The disk cache JSON schema becomes `{"messages": [...], "config": {...}}` (was: just the messages list). Existing cache files become invalid — handled by versioning the cache filename to `<name>-<label>.v2.json` so we never read a v1 file as v2 by accident.
- `_call_openai(... , output_schema)`: when schema is present, set
  `params["response_format"] = {"type": "json_schema",
                                "json_schema": {"name": trace_name,
                                                "strict": True,
                                                "schema": output_schema}}`
  This *replaces* the `{"type": "json_object"}` path (mutually exclusive).
- `_call_anthropic(... , output_schema)`: when schema is present, build
  ```python
  tools = [{"name": trace_name,
            "description": "Return the requested structured output.",
            "input_schema": output_schema}]
  tool_choice = {"type": "tool", "name": trace_name}
  ```
  Send these on `messages.create(...)`; in the response, find the `tool_use` block whose `name == trace_name`, take `block.input` (already a dict), and return `json.dumps(block.input)` so the existing call-site parsers still work unchanged.
- Malformed `output_schema` (e.g. someone edits it badly in the Langfuse UI to a non-dict): in `chat()`, before sending to the provider, validate it's a dict-with-a-"type"-key; if not, log a WARNING (`"output_schema for <trace_name> is malformed; falling back to no-schema mode"`) and proceed as if no schema was supplied.

### `push_seed_prompts`

Per-seed, pass `config=seed["config"]` to `create_prompt` (the v4 SDK accepts `config` as a kwarg). When `config` is empty/`{}`, still pass it through — Langfuse stores `{}` as the prompt's config.

### Feature call-sites (the 7 JSON-output features)

Each file changes by **two lines**:

```diff
- messages = lf_client.get_prompt(name, variables)
+ messages, config = lf_client.get_prompt(name, variables)
  raw = lf_client.chat(
      messages, model=model, provider=provider, api_key=api_key,
      base_url=ai_cfg.get("base_url"), max_tokens=max_tokens,
      trace_name=name, json_mode=(provider != "anthropic"),
+     output_schema=config.get("output_schema"),
  )
```

The existing `_parse_*` helpers stay. With schema enforcement on, they will reliably see correctly-shaped JSON; if a future call site uses a prompt with no schema, they continue to work as today's fallback.

## Data flow

### Cold start
1. User merges this PR, runs `python3 src/data/make.py push-prompts --force`.
2. Each prompt is recreated in Langfuse with both `prompt=messages` AND `config={"output_schema": {...}}` (or empty for `summaries`).
3. User can edit the schema in the Langfuse UI's prompt-config field; subsequent fetches pick up the edit.

### Steady-state (one AI call)
1. Feature code: `messages, config = lf_client.get_prompt(name, vars)`.
2. `_resolve_raw` returns the v2 cache entry (or fetches + caches).
3. Feature code: `chat(messages, ..., output_schema=config.get("output_schema"))`.
4. `chat()` checks the schema. If present and valid-shaped → provider-native enforcement. If absent or malformed → no-schema path (today's behavior + WARNING in the malformed case).
5. Tracing is unchanged — the Langfuse generation still records input/output/tokens/cost. The fact that a schema was used isn't separately recorded (the prompt object referenced in the generation already carries its config).

### Offline path
1. Disk cache or seed returns `{"messages": [...], "config": {...}}` — same code path as online.
2. Schema enforcement still kicks in (the provider call still goes out to OpenAI/Anthropic, just the *prompt* came from offline storage).
3. If a user has run with the old prompt-management migration but not yet `push-prompts`-ed the new seeds, their Langfuse-stored prompts have no schema → no-schema path → identical behavior to today. Running `push-prompts --force` upgrades them.

## Error handling

Two safety rules govern this change:

- **A bad schema must never lock out a previously-working feature.** Anything we can't parse/use degrades to today's no-schema behavior with a WARNING that names the prompt and reason.
- **A provider rejection IS a real failure** (e.g. OpenAI returning 400 because our schema is malformed in a way we didn't detect; or Anthropic refusing the forced tool call). It propagates through the feature's existing `try/except` exactly like today's provider errors — empty output + log.warning. We do NOT silently fall back to no-schema on a provider error, because that would hide a real bug.

| Failure | Behavior | User-visible |
|---|---|---|
| Schema absent (seed or Langfuse stored `{}`) | No-schema path | nothing |
| `output_schema` is not a dict / missing `type` | WARNING `"output_schema for <name> malformed; falling back"`, no-schema path | one log line |
| OpenAI 400 on schema (we wrote it wrong) | Existing `try/except` in feature → empty output, ERROR log naming the schema | feature returns empty (same as any provider error today) |
| Anthropic tool_choice refused / no tool_use block in response | Same as above | same |
| Cache file is v1 (pre-schema layout) | `_resolve_raw` ignores v1 files (versioned filename); next call writes v2 | one fetch instead of one cache hit |
| `push_seed_prompts` sends a config but the prompt already exists with a different one (without `--force`) | "skipped" — config not updated. Documented in CLAUDE.md (`--force` re-pushes everything including configs) | nothing |

## Testing strategy

### Unit tests — `tests/test_lf_client.py`
- `chat(provider=openai, output_schema=X)` calls OpenAI with `response_format={"type":"json_schema", "json_schema":{"name": trace_name, "strict": True, "schema": X}}` and NO `{"type":"json_object"}` (mutually exclusive).
- `chat(provider=anthropic, output_schema=X)` calls Anthropic with `tools=[{name, input_schema=X, description}]` + `tool_choice={"type":"tool","name": trace_name}`, and returns `json.dumps(tool_use.input)` from the response.
- `chat(... output_schema=None)` is today's behavior for both providers (regression guard).
- `chat(... output_schema={"not": "a real schema"})` logs WARNING and falls back to no-schema (malformed → safe degrade).
- `get_prompt` returns a `(messages, config)` tuple; config defaults to `{}` when the seed has none.
- Disk cache: v2 layout round-trips; a v1 file (just a list) is ignored (no crash, no wrong shape).
- `push_seed_prompts` sends `config=` matching each seed's config (verified via the FakeLF recorder).

### Seed validation — `tests/test_seed_prompts.py`
- Every seed value is a dict with keys `{"messages", "config"}` (the new structural test).
- All existing seed tests adapted to the new shape (e.g. `set(SEED_PROMPTS) == EXPECTED_NAMES` still works; `msgs = SEED_PROMPTS[name]["messages"]`).
- Every `config["output_schema"]` (where present) validates against the JSON Schema 2020-12 meta-schema (catches typos in our schemas at test time). Use `jsonschema` library (already a transitive dep of `langfuse`? — confirm at implementation; if not, add it).
- OpenAI Strict-mode contract: walk every object schema in every `output_schema` and assert `additionalProperties` is set (`false` OR a schema, never absent) and `required` lists every key in `properties`. Exception: the `classifier_classify` "classifications" map (documented).

### Per-feature real-compile tests — the 7 hardened files
- Each test already mocks only `chat`. Add: `assert ch.call_args.kwargs.get("output_schema") is not None` for the 7 JSON features; `assert ch.call_args.kwargs.get("output_schema") is None` for `summaries`.

### Manual live check (PR checklist)
- After `push-prompts --force`, confirm each prompt in the Langfuse UI shows its `config.output_schema`.
- Edit one schema in the UI to be intentionally invalid (e.g. set the type to "banana"); run `build-report`; confirm the feature degrades gracefully with a WARNING log and the report still builds (other features unaffected).
- Restore the schema; re-run; confirm strict mode produces structurally-perfect JSON (visible in the Langfuse trace's generation output).

## Open questions / deferred decisions

- **Where to source the chart-type and stat-type enums.** They currently live in code (`CHART_DISPATCH` in `src/reports/charts.py`; the stat dispatch in `src/reports/summaries.py`). To keep the schema in sync as new charts/stats are added, the implementation plan should either (a) generate the schema enum from the dispatch at module-load time, or (b) document it as a sync-on-change discipline. Decision deferred to the plan; recommend (a).
- **Whether to add `jsonschema` as an explicit dep** for the meta-schema test. Verify whether it's already pulled in transitively; if not, add to requirements.
- **Anthropic version check.** Anthropic's tool API has evolved; verify the installed `anthropic>=0.20.0` supports `tool_choice={"type":"tool","name":...}`. Should be confirmed at the start of implementation, similar to how the prior feature probed langfuse v4 before writing code.

## References

- Prior feature spec: [2026-05-27-langfuse-prompt-management-design.md](./2026-05-27-langfuse-prompt-management-design.md)
- OpenAI Structured Outputs: https://platform.openai.com/docs/guides/structured-outputs
- Anthropic Tool use: https://docs.anthropic.com/en/docs/build-with-claude/tool-use
- Langfuse prompt `config`: https://langfuse.com/docs/prompts/config
- Existing code: `src/utils/lf_client.py`, `src/utils/seed_prompts.py`, and the 7 feature files
