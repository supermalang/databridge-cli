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

## Test structure (Component — Testing Library)

For new React components or significant UI changes. Only write this layer if the task touches `frontend/src/components/` or a page component.

Prerequisite: `vitest` + `@testing-library/react` + `jsdom` must be in `frontend/package.json`.

```js
// frontend/tests/unit/<Component>.test.jsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import MyComponent from '../../src/components/MyComponent'

describe('MyComponent', () => {
  it('renders the expected label', () => {
    render(<MyComponent label="Test" />)
    expect(screen.getByText('Test')).toBeInTheDocument()
  })

  it('calls onSave when button clicked', async () => {
    const onSave = vi.fn()
    render(<MyComponent onSave={onSave} />)
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).toHaveBeenCalledOnce()
  })
})
```

Mock collaborators (API calls, hooks) — do not use real network or DB here.

## Test structure (Integration — FastAPI + real DB)

For API endpoint behaviour that spans the request handler, DB query, and response. Use the existing test self-provisioning (SQLite + `DATABRIDGE_SKIP_MIGRATIONS=1`).

```python
# tests/test_<endpoint>_integration.py
import pytest
from fastapi.testclient import TestClient
from web.main import app

@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c

def test_<endpoint>_returns_<expected>(client, test_project):
    resp = client.get('/api/<endpoint>', headers=auth_headers(test_project))
    assert resp.status_code == 200
    assert resp.json()['key'] == expected_value
```

**No mocks for the DB layer** — integration tests hit the real SQLite test DB. Mock only external services (Kobo API, Langfuse, S3) using `monkeypatch` or `respx`.

## Test structure (Accessibility — axe)

Add to any Playwright spec that introduces a new UI component or page:

```js
import { checkA11y, injectAxe } from 'axe-playwright'

test('page has no a11y violations', async ({ page }) => {
  await page.goto('/<route>')
  await injectAxe(page)
  await checkA11y(page, '.page:visible', {
    detailedReport: true,
    detailedReportOptions: { html: true },
  })
})
```

Only add the axe layer when a new component ships — not for pure logic changes.

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

## Which layers to write

Only write the layers the task actually touches:

| Task touches | Write |
|---|---|
| Python logic / CLI | Unit (pytest) |
| FastAPI endpoint | Unit + Integration |
| New React component | Unit (Testing Library) + Component + Axe |
| Full user flow | E2E (Playwright) |
| UI appearance | Visual snapshot (after sign-off only) |

## Coverage targets

- Python: one test per acceptance criterion; cover nominal + at least one edge/error case
- Integration: cover the full request→DB→response path for each AC
- Component: cover each prop/state combination described in the AC
- Playwright: cover the full user flow described in the card's E2E field
- Three viewports are automatic (playwright.config.ts): mobile/tablet/desktop

## Visual snapshot governance

```
Functional E2E   *.spec.js        ← RED/GREEN contract
Visual snapshots *.visual.spec.js ← baseline approved by human after ux-review + qa-tester
```

Never merge visual snapshots into the functional spec. Baselines committed only after human approval.
