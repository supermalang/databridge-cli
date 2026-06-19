import { test, expect, Page } from '@playwright/test';

/**
 * XTF-11 — Terminal: show ~5s during a build then auto-collapse; auto-expand on error.
 *
 * NETWORK-MOCKED end-to-end (same long-lived controllable-SSE pattern as
 * run-alert.spec.ts): the Vite dev server serves the real SPA, every `/api/**` is
 * intercepted, so NO FastAPI backend is required.
 *
 * The behavior under test needs a LONG-LIVED "running" state — the terminal must
 * auto-collapse to its bar WHILE the build is still running. We hold the app in the
 * running state by parking the SSE response body's controller on `window.__runStream`
 * (the stream stays open until the test calls .close()), exactly as run-alert.spec.ts.
 *
 * ── Contract pinned for the implementer ───────────────────────────────────────────
 *  1. OVERRIDABLE AUTO-COLLAPSE DELAY (default ~5000 ms):
 *     App.jsx must read `window.__TERM_COLLAPSE_MS` (a Number, milliseconds) and use it
 *     as the auto-collapse delay when present, falling back to the ~5000 ms default.
 *     This test sets it to 50 ms via addInitScript BEFORE the app boots. No real 5s wait.
 *
 *  2. OPEN/COLLAPSED SIGNAL: BottomTerminal renders `.bottom-term` with
 *     `data-open="true"` when expanded and `data-open="false"` when collapsed to the bar
 *     (already present today). The auto-timing flips this attribute; the test asserts on it.
 *
 *  3. AUTO-TIMING BEHAVIOR on a build run:
 *     - terminal OPENS (`data-open="true"`) when the build run starts (`running`)
 *     - after the configured delay it auto-COLLAPSES (`data-open="false"`) EVEN THOUGH
 *       the run is still streaming
 *     - if the run subsequently ends in `error`, the terminal AUTO-EXPANDS
 *       (`data-open="true"`)
 *     - on a clean `success` it STAYS collapsed (no re-expand / flicker)
 *
 * SSE frame shapes pushed by the test (must match useCommand.js parsing —
 * `event: <ev>\ndata: <json>\n\n`):
 *   - { event: 'log',    line: '…', level: 'info' }
 *   - { event: 'status', command: 'build-report', status: 'running', run_id: RUN_ID }
 *   - { event: 'status', command: 'build-report', status: 'error' | 'success' }  (terminal)
 */

const RUN_ID = 'run-xtf11-abc123';

// Tiny auto-collapse delay so the E2E never waits the real ~5s.
const COLLAPSE_MS = 50;

const ACTIVE_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  slug: 'test-project',
  role: 'admin',
  is_archived: false,
};

const CONFIG_YML =
  'api:\n  url: https://kobo.example.test\n  token: t\n' +
  'form:\n  alias: test\n' +
  'questions:\n  - kobo_key: Q1\n    label: Q1\n    type: text\n';

// Init script: monkeypatch fetch for the build-report run so its SSE body is a
// controllable, long-lived ReadableStream. Parked on window.__runStream for the test.
const RUN_STREAM_INIT = `
  (() => {
    const enc = new TextEncoder();
    let controller = null;
    const stream = new ReadableStream({ start(c) { controller = c; } });
    window.__runStream = {
      push(obj) {
        const ev = obj.event || 'message';
        const data = JSON.stringify(obj);
        controller.enqueue(enc.encode('event: ' + ev + '\\ndata: ' + data + '\\n\\n'));
      },
      close() { try { controller.close(); } catch (e) {} },
    };
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.includes('/api/run/build-report')) {
        window.__buildTriggered = true;
        return Promise.resolve(new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }));
      }
      return realFetch(input, init);
    };
  })();
`;

// Pin the overridable auto-collapse delay to a few ms BEFORE the app boots.
const COLLAPSE_DELAY_INIT = `window.__TERM_COLLAPSE_MS = ${COLLAPSE_MS};`;

async function stubBootstrap(page: Page) {
  // Catch-all FIRST so the specific routes below win (last registered wins).
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null } }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: true, verified: true } }));
  await page.route('**/api/data/sessions', (r) =>
    r.fulfill({ json: { sessions: [{ session_id: 's1', label: 'session 1', files: ['data.csv'] }] } }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) =>
    r.fulfill({ json: { files: [{ name: 'report_template.docx' }] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: true, has_data: true, has_templates: false, has_ai: true } }));
}

// Drive a real `run('build-report')` from the Reports tab "Build report" button, so the
// production useCommand.run path runs end-to-end (NOT a test-only shortcut).
async function startBuild(page: Page) {
  await page.locator('.tabs-bar .tab', { hasText: 'Deliver' }).click();
  await page.locator('.subtabs-bar .subtab', { hasText: 'Reports' }).click();
  const buildBtn = page.getByRole('button', { name: /build report/i });
  await expect(buildBtn).toBeVisible();
  await buildBtn.click();
  // Proves the long-lived SSE mock is wired (so later assertions are the XTF-11 gap).
  await expect.poll(() => page.evaluate(() => (window as any).__buildTriggered === true)).toBe(true);
}

async function emitRunning(page: Page) {
  await page.evaluate((runId) => {
    (window as any).__runStream.push({ event: 'log', line: 'building report', level: 'info' });
    (window as any).__runStream.push({ event: 'status', command: 'build-report', status: 'running', run_id: runId });
  }, RUN_ID);
}

const term = (page: Page) => page.locator('.bottom-term');

test.describe('XTF-11 — terminal auto-collapses during a build and auto-expands on error', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(COLLAPSE_DELAY_INIT);
    await page.addInitScript(RUN_STREAM_INIT);
    await stubBootstrap(page);
    await page.goto('http://localhost:51730/');
  });

  test('opens on running, auto-collapses to the bar while still running, then auto-expands on error', async ({ page }) => {
    // SANITY: the real SPA mounted logged-in with the active project, so any later
    // failure is the missing XTF-11 timing — not a broken render / bad mock.
    await expect(page.getByText('Test Project')).toBeVisible();
    await expect(page.locator('.tabs-bar .tab', { hasText: 'Deliver' })).toBeVisible();

    // Terminal starts collapsed.
    await expect(term(page)).toHaveAttribute('data-open', 'false');

    await startBuild(page);
    await emitRunning(page);

    // SANITY (correct-red guard): the terminal OPENS right after `running`. If this
    // fails the mock/boot is broken — not the auto-collapse behavior we are testing.
    await expect(term(page)).toHaveAttribute('data-open', 'true');

    // AC: after the configured (tiny test) delay it auto-collapses to the bar EVEN
    // THOUGH the run is still streaming (we have NOT closed the SSE stream).
    //   RED TODAY: onStatus opens on `running` and only collapses after `success`, so
    //   while the run keeps streaming the terminal stays data-open="true" forever —
    //   this assertion times out / fails. That is the correct red.
    await expect(term(page)).toHaveAttribute('data-open', 'false');

    // Visual baseline of the collapsed-during-run state (3 viewports via config).
    await expect(page).toHaveScreenshot('terminal-collapsed.png');

    // AC: the run subsequently ends in error — the terminal auto-expands so the
    // failure log is visible. Stream stays open through the error frame, mirroring SSE.
    await page.evaluate(() => {
      (window as any).__runStream.push({ event: 'log', line: 'build failed', level: 'error' });
      (window as any).__runStream.push({ event: 'status', command: 'build-report', status: 'error' });
      (window as any).__runStream.close();
    });
    await expect(term(page)).toHaveAttribute('data-open', 'true');

    // Visual baseline of the auto-expanded error state (3 viewports via config).
    await expect(page).toHaveScreenshot('terminal-error-expanded.png');
  });

  test('clean success stays collapsed — no second flicker / re-expand', async ({ page }) => {
    await expect(page.getByText('Test Project')).toBeVisible();
    await expect(term(page)).toHaveAttribute('data-open', 'false');

    await startBuild(page);
    await emitRunning(page);

    // SANITY: opened on running.
    await expect(term(page)).toHaveAttribute('data-open', 'true');

    // AC: auto-collapses after the delay while still running.
    await expect(term(page)).toHaveAttribute('data-open', 'false');

    // The run then ends cleanly. It must STAY collapsed (already collapsed during the
    // run) — no second flicker / re-expand.
    await page.evaluate(() => {
      (window as any).__runStream.push({ event: 'log', line: 'done', level: 'info' });
      (window as any).__runStream.push({ event: 'status', command: 'build-report', status: 'success' });
      (window as any).__runStream.close();
    });

    // Give any (incorrect) re-expand timer a chance to fire, then assert still collapsed.
    await expect(term(page)).toHaveAttribute('data-open', 'false');
    await expect(term(page)).toHaveAttribute('data-open', 'false');
  });

  test('manual toggle still works — opening the terminal by hand is not overridden by auto-timing', async ({ page }) => {
    await expect(page.getByText('Test Project')).toBeVisible();
    await expect(term(page)).toHaveAttribute('data-open', 'false');

    // Open the collapsed bar by clicking it (BottomTerminal bar is role=button).
    await page.locator('.bottom-term__bar').click();
    await expect(term(page)).toHaveAttribute('data-open', 'true');

    // It stays open until the user collapses it again — the auto-collapse timing only
    // applies during a build run, not to a user-opened idle terminal.
    await expect(term(page)).toHaveAttribute('data-open', 'true');
    await page.locator('.bottom-term__bar').click();
    await expect(term(page)).toHaveAttribute('data-open', 'false');
  });
});
