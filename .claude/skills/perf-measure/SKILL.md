---
name: perf-measure
description: Runtime performance measurer. Vite bundle sizes, Core Web Vitals via Playwright, DB EXPLAIN plans. Writes reports to .scratch/perf-measure/. Use after perf-review to confirm fixes worked.
---

# /perf-measure — Runtime Performance Measurer (databridge-cli)

Measures actual performance against budgets. Use after `/perf-review` to validate that
static-analysis fixes produced real improvements.

## Budgets (defaults — override in .claude/context.md if agreed)

| Metric | Budget |
|---|---|
| Total gzipped JS (main bundle) | < 300 KB |
| LCP (Largest Contentful Paint) | < 2.5 s |
| INP (Interaction to Next Paint) | < 200 ms |
| CLS (Cumulative Layout Shift) | < 0.1 |
| Hot-path query (EXPLAIN cost) | No sequential scan on table > 10K rows |

## 1 — Bundle analysis (Vite)

```bash
cd frontend && npm run build 2>&1
# Vite prints chunk sizes at the end — review them
# For gzipped size:
find frontend/dist/assets -name "*.js" -exec gzip -c {} \; | wc -c
```

Flag any single chunk > 100 KB gzipped. Check if heavy imports (chart libraries, docx) are lazy.

## 2 — Core Web Vitals

Requires dev server running: `./scripts/serve.sh` (prod-like) or `./scripts/dev.sh`.

If a vitals Playwright spec exists:
```bash
cd frontend && npx playwright test --grep "@vitals" --reporter=line
```

If not, use the browser DevTools Performance panel manually on the Dashboard and Reports tabs,
and note the readings in the report. Recommend adding a `vitals.spec.js` if absent.

## 3 — Database EXPLAIN plans

Requires `DATABASE_URL` pointing to a populated test/dev database.

For each hot-path query identified by `/perf-review`:

```bash
PYTHONPATH=. python3 - <<'EOF'
import os
from sqlalchemy import create_engine, text
engine = create_engine(os.environ['DATABASE_URL'])
with engine.connect() as conn:
    result = conn.execute(text("EXPLAIN (ANALYZE, FORMAT TEXT) SELECT ..."))
    print('\n'.join(r[0] for r in result))
EOF
```

Flag: `Seq Scan` on a table with estimated rows > 10K, `Nested Loop` on FK without index.

## 4 — Report

Write to `.scratch/perf-measure/<YYYY-MM-DD>-report.md`:

```markdown
# Performance Report — <date>

## Bundle
| Chunk | Gzipped | Budget | Status |
|---|---|---|---|
| main | X KB | 300 KB | PASS/FAIL |

## Web Vitals
| Metric | Measured | Budget | Status |
|---|---|---|---|
| LCP | Xs | 2.5s | PASS/FAIL |

## Query plans
| Query | Plan | Flag |
|---|---|---|
| GET /api/runs | Index Scan | OK |

## Blockers
<budget violations>

## Warnings
<near-threshold metrics, server-unavailable notes>
```

Return: report path, blockers, warnings. Escalate fixes to `/refactor` or `/schema-agent`.
