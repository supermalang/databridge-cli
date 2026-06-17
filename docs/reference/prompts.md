# Prompt management (Langfuse)

Prompts live in [Langfuse Cloud](https://cloud.langfuse.com) (or a self-hosted Langfuse
instance). Each AI feature fetches its prompt by name at runtime via
`src/utils/lf_client.py`.

## Prompt names and consuming files

| Prompt name | Consuming file | Output contract |
|---|---|---|
| `narrator` | `src/reports/narrator.py` | JSON: `summary_text` / `observations` / `recommendations` |
| `summaries` | `stat: ai` blocks in `src/reports/summaries.py` | Plain text |
| `chart_suggester` | `src/reports/ai_chart_suggester.py` | JSON: `{"charts": [...]}` |
| `template_generator` | `src/reports/ai_template_generator.py` | JSON: layout spec |
| `summary_suggester` | `src/reports/ai_summary_suggester.py` | JSON: suggested summaries |
| `view_suggester` | `src/reports/ai_view_suggester.py` | JSON: suggested views |
| `table_suggester` | `src/reports/ai_table_suggester.py` | JSON: `{"tables": [...]}` |
| `indicator_suggester` | `src/reports/ai_indicator_suggester.py` | JSON: `{"indicators": [...]}` |
| `hidden_suggester` | `src/reports/ai_hidden_suggester.py` | JSON: `{"suggestions": [...]}` |
| `pii_suggester` | `src/reports/ai_pii_suggester.py` | JSON: `{"suggestions": [...]}` |
| `classifier_discover` | `src/data/classifier.py` | JSON: discovered themes |
| `classifier_classify` | `src/data/classifier.py` | JSON: per-row classifications |
| `ask_propose` | `src/reports/ask_engine.py` | JSON: `{"items": [{"kind": ...}]}` |
| `ask_caption` | `src/reports/ask_engine.py` | JSON: `{"captions": {...}}` |
| `ask_refine` | `src/reports/ask_engine.py` | JSON: `{"item": {"kind": ...}}` |
| `ask_examples` | `src/reports/ai_ask_examples.py` | JSON: `{"questions": [...]}` |

## Setup

1. Create a free account at [cloud.langfuse.com](https://cloud.langfuse.com) (or use a
   self-hosted instance).
2. Copy your public key, secret key, and host URL into `.env`:
   ```
   LANGFUSE_PUBLIC_KEY=pk-lf-...
   LANGFUSE_SECRET_KEY=sk-lf-...
   LANGFUSE_HOST=https://cloud.langfuse.com   # default; omit for cloud
   # LANGFUSE_BASE_URL is accepted as an alias if LANGFUSE_HOST is unset
   ```
3. Seed the bundled default prompts into Langfuse:
   ```bash
   python3 src/data/make.py push-prompts          # create-if-missing
   python3 src/data/make.py push-prompts --force  # overwrite existing
   ```
4. Edit prompts directly in the Langfuse UI — version history is tracked automatically.

## Offline / fallback behavior

Prompts are resolved in this order:
1. **Cache-first** — `~/.cache/databridge/prompts/` (1-hour TTL)
2. **Langfuse** — fetched over HTTPS if the cache is stale or missing
3. **Bundled seeds** — `src/utils/seed_prompts.py` (always present, no network needed)

AI features keep working with no Langfuse keys (they use the bundled seeds) and with no AI
provider keys (the feature no-ops gracefully).

## Tracing

Every LLM call is recorded as a Langfuse generation with cost, latency, and token counts.
CLI commands group all their calls under a single trace so you can follow the full pipeline
run in the Langfuse UI.

## Add a new prompt site

1. Add an entry to `SEED_PROMPTS` in `src/utils/seed_prompts.py` with the prompt name,
   system message, and any variable placeholders.
2. In your feature file, build a `variables` dict and call:
   ```python
   prompt = lf_client.get_prompt("<name>", variables)
   response = lf_client.chat(..., trace_name="<name>")
   ```
3. Run `python3 src/data/make.py push-prompts` to seed the new prompt in Langfuse.
4. Document the new prompt name in the table above.

## Output schemas (structured outputs)

Twelve of the sixteen prompts produce JSON and have an `output_schema` in their seed's
`config` (all except `summaries`, `ask_propose`, `ask_caption`, and `ask_refine`). The
schema travels with the prompt (stored in Langfuse's per-prompt `config` field) and is
enforced at the LLM call:

- **OpenAI** — sent via `response_format={"type":"json_schema", ...}` (Structured Outputs).
  The model is guaranteed to return JSON matching the schema.
- **Anthropic** — sent via a forced tool-use call (`tools=[{input_schema=...}]` +
  `tool_choice`). The model's response is the tool's `input` dict.

Editing a schema in the Langfuse UI updates both providers' enforcement on the next fetch.
If you write an invalid schema (not a dict, or missing `"type"`), the next call logs a
WARNING and falls back to no-schema mode for that one prompt — the feature still runs.

To add a schema to a new prompt:
1. Add `_<NAME>_OUTPUT_SCHEMA` literal in `src/utils/seed_prompts.py` (Strict-mode rules:
   `additionalProperties: false`, every property listed in `required`, no `oneOf`).
2. Reference it in the entry's `config={"output_schema": ...}`.
3. `python3 src/data/make.py push-prompts --force` to update Langfuse.

The seed-validation test (`tests/test_seed_prompts.py`) enforces meta-schema validity and
the Strict-mode contract; intentional open maps are listed in `_ALLOWED_OPEN_MAPS`.
