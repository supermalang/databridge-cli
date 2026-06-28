---
name: test-writer
description: General-purpose TDD test author — RED and GREEN modes. Writes pytest unit tests and Playwright E2E specs. For roadmap pipeline work, prefer roadmap-test-author which enforces strict author/implementer separation.
---

# /test-writer — TDD Test Author (databridge-cli)

General-purpose test author for work inside or outside the roadmap pipeline.
For roadmap pipeline tasks, prefer `roadmap-test-author` (strict RED-only, pipeline-integrated).

## Modes

### RED mode — write failing tests

Derive every assertion from acceptance criteria or a bug description. Do NOT read implementation.

```bash
# Prove RED
PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/<new_file> -v
cd frontend && npm run test:e2e -- --grep "<spec name>"
```

Each test must FAIL because the behaviour is missing — not because of an import error or fixture bug.
Rewrite until it fails for the right reason.

### GREEN mode — verify tests pass

Run existing tests unchanged. If any fail, escalate to `/debugger`.
Never modify a test to force it green.

## Test structure (Python — pytest)

```python
# tests/test_<module>.py
import pytest
from src.<module> import <symbol>

class Test<Feature>:
    def test_<behaviour>_given_<condition>(self):
        # Arrange
        ...
        # Act
        result = <symbol>(...)
        # Assert
        assert result == expected

    @pytest.mark.parametrize("input,expected", [...])
    def test_<behaviour>_parametric(self, input, expected):
        ...
```

FastAPI endpoint tests use `TestClient` from `web/main.py`:
```python
from fastapi.testclient import TestClient
from web.main import app
client = TestClient(app)
```

## Test structure (Playwright — E2E)

Functional assertions in `frontend/tests/e2e/<feature>.spec.js`:
```js
import { test, expect } from '@playwright/test'

test('<behaviour>', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Sources' }).click()
  await expect(page.getByText('expected text')).toBeVisible()
})
```

Visual snapshots in `frontend/tests/e2e/<feature>.visual.spec.js` (separate file):
```js
await expect(page.locator('.page:visible')).toHaveScreenshot()
```

Visual baselines are captured ONLY after `/ux-review` + `/qa-tester` sign-off. Never during RED.

## Coverage targets

- Python: one test per acceptance criterion; cover nominal + at least one edge/error case
- Playwright: cover the full user flow described in the card's E2E field
- Three viewports are automatic (playwright.config.ts): mobile/tablet/desktop

## Visual snapshot governance

```
Functional E2E   *.spec.js        ← RED/GREEN contract
Visual snapshots *.visual.spec.js ← baseline approved by human after ux-review + qa-tester
```

Never merge visual snapshots into the functional spec. Baselines committed only after human approval.
