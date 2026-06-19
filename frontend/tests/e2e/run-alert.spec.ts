import { test, expect, Page } from '@playwright/test';

/**
 * XTF-14 — Reposition the run alert in-page (below the title, content width) + icon Stop.
 *
 * Refinement of XTF-10. XTF-10 shipped a FIXED bar pinned above the top nav (outside the
 * page content). XTF-14 moves that same alert to flow INSIDE the page content — below the
 * top nav (`.tabs-bar`) and the page header (the `databridge-cli` title), before the main
 * pane container — at the content width with top + bottom margin, NOT a viewport-pinned
 * full-bleed bar. The text "Stop" button becomes a compact ICON button carrying an
 * accessible `aria-label`. All XTF-10 behavior (shown while running, names the active
 * command, View-logs toggles the terminal, stop → /api/stop/{run_id}, clears on terminal
 * status, role="status") is preserved.
 *
 * NETWORK-MOCKED end-to-end (same pattern as express-template-fill.spec.ts): the Vite dev
 * server serves the real SPA, every `/api/**` is intercepted, so NO FastAPI backend is
 * required.
 *
 * The behavior under test needs a LONG-LIVED "running" state — `useCommand.running` stays
 * true only while the SSE response body for POST /api/run/build-report is still open
 * (useCommand reads res.body.getReader() in a loop; `running` flips false in the `finally`
 * once the stream closes). `page.route(...).fulfill({ body })` sends a complete body and
 * closes immediately, so it CANNOT hold the app in the running state.
 *
 * Instead we install an init-script that monkeypatches `window.fetch` for
 * /api/run/build-report only, returning a Response backed by a ReadableStream whose
 * controller is parked on `window.__runStream`. The test drives it:
 *   - window.__runStream.push(obj)  → enqueues one SSE frame (event inferred from obj)
 *   - window.__runStream.close()    → ends the stream (closes the body → running=false)
 * All other /api/** calls go through the normal page.route() bootstrap stubs.
 *
 * SSE frame shapes pushed by the test (must match useCommand.js parsing —
 * `event: <ev>\ndata: <json>\n\n`, run_id read off a `status` frame's payload.run_id):
 *   - { event: 'log',    line: 'building report', level: 'info' }
 *   - { event: 'status', command: 'build-report', status: 'running', run_id: RUN_ID }
 *   - { event: 'status', command: 'build-report', status: 'success' }   (terminal)
 *
 * Selector / behavior contract the implementer must satisfy:
 *   - data-testid="run-alert"  — an alert shown WHENEVER `running` is true, reading the
 *     active command (text matches /building/i for build-report); role="status" or
 *     role="alert". Disappears (count 0) on a terminal status. NEW (XTF-14): it renders
 *     IN the page content flow — below the top nav (`.tabs-bar`) AND below the page header
 *     — and is NOT a `position: fixed` viewport-pinned bar.
 *   - data-testid="run-stop"   — a real <button> inside the alert with NO visible "Stop"
 *     text (an icon button) but WITH a non-empty accessible name (`aria-label`); clicking
 *     it calls useCommand.stop() → POST /api/stop/{run_id} (falling back to /api/stop when
 *     no run_id yet). `stop` is threaded through RunContext.
 *   - the OLD `.run-indicator` nav badge is REMOVED (count 0) while running.
 *   - View logs control still toggles the bottom terminal.
 */

const RUN_ID = 'run-xtf14-abc123';

const ACTIVE_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  slug: 'test-project',
  role: 'admin',
  is_archived: false,
};

// Config rich enough that the Reports "Build report" button's preconditions are met
// (Reports.jsx buildMissing checks api.url+token, questions[], a data session, and a
// template). report.template defaults to templates/report_template.docx, which we list
// in /api/templates below so hasTemplate is true.
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

async function stubBootstrap(page: Page) {
  // Catch-all FIRST so the specific routes below win (Playwright matches routes in
  // REVERSE registration order — last registered wins).
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null } }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: true, verified: true } }));
  // A data session + the default template so the Build report button's preconditions
  // are met (buildReady === true) and the genuine run('build-report') path is clickable.
  await page.route('**/api/data/sessions', (r) =>
    r.fulfill({ json: { sessions: [{ session_id: 's1', label: 'session 1', files: ['data.csv'] }] } }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) =>
    r.fulfill({ json: { files: [{ name: 'report_template.docx' }] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: true, has_data: true, has_templates: false, has_ai: true } }));
}

// Trigger a real `run('build-report')` from JS — the alert/stop must work for ANY run
// trigger (the RunProvider shares the single useCommand instance app-wide). We dispatch
// through the same hook the Reports "Build report" button uses; doing it in-page keeps
// the spec independent of which tab/affordance is currently reachable, while still
// exercising the genuine useCommand.run path (NOT a test-only shortcut).
async function triggerBuild(page: Page) {
  // The Reports tab "Build report" button calls run('build-report'); navigate there and
  // click it so we drive the production code path end-to-end. "Deliver" is a top-level
  // stage with sub-tabs (Output · Templates · Reports) — select the Reports subtab.
  await page.locator('.tabs-bar .tab', { hasText: 'Deliver' }).click();
  await page.locator('.subtabs-bar .subtab', { hasText: 'Reports' }).click();
}

test.describe('XTF-14 — in-page run alert (below the title, content width) + icon Stop', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(RUN_STREAM_INIT);
    await stubBootstrap(page);
    await page.goto('http://localhost:51730/');
  });

  test('running build → in-page alert (below nav + title, not fixed); icon Stop hits /api/stop/{run_id}; View logs toggles terminal; terminal status clears alert', async ({ page }) => {
    // Capture the stop request so we can assert the run_id from the SSE frame is used.
    const stopCalls: string[] = [];
    await page.route('**/api/stop/**', (r) => { stopCalls.push(new URL(r.request().url()).pathname); return r.fulfill({ json: { ok: true } }); });
    await page.route('**/api/stop', (r) => { stopCalls.push(new URL(r.request().url()).pathname); return r.fulfill({ json: { ok: true } }); });

    // SANITY: the real SPA mounted logged-in with the active project, so any later
    // failure is the missing/repositioned alert — not a broken render / bad mock.
    await expect(page.getByText('Test Project')).toBeVisible();
    await expect(page.locator('.tabs-bar .tab', { hasText: 'Deliver' })).toBeVisible();

    // Before any run there is no alert.
    await expect(page.getByTestId('run-alert')).toHaveCount(0);

    // Trigger a build via the real run('build-report') path (Reports tab button).
    await triggerBuild(page);
    const buildBtn = page.getByTestId('build-run');
    await expect(buildBtn).toBeVisible();
    await buildBtn.click();

    // SANITY: the build run was actually triggered (proves the long-lived SSE mock is
    // wired), so a missing alert below is the XTF gap — not a dead trigger.
    await expect.poll(() => page.evaluate(() => (window as any).__buildTriggered === true)).toBe(true);

    // Drive the long-lived SSE: emit a log + a `running` status carrying the run_id.
    await page.evaluate((runId) => {
      (window as any).__runStream.push({ event: 'log', line: 'building report', level: 'info' });
      (window as any).__runStream.push({ event: 'status', command: 'build-report', status: 'running', run_id: runId });
    }, RUN_ID);

    // ── PRESERVED (XTF-10): alert visible while running, naming the active command ──
    const alert = page.getByTestId('run-alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/building/i);

    // PRESERVED (XTF-10): accessible — role="status" or role="alert".
    const role = await alert.getAttribute('role');
    expect(role === 'status' || role === 'alert', 'run-alert must have role status or alert').toBeTruthy();

    // PRESERVED (XTF-10): the OLD nav badge is removed.
    await expect(page.locator('.run-indicator')).toHaveCount(0);

    // ── NEW (XTF-14): in-page placement — below the top nav AND the page header, and
    // NOT a viewport-pinned fixed bar. ───────────────────────────────────────────────
    const nav = page.locator('nav.tabs-bar');
    const header = page.locator('header').first();
    await expect(nav).toBeVisible();
    await expect(header).toBeVisible();

    const alertBox = await alert.boundingBox();
    const navBox = await nav.boundingBox();
    const headerBox = await header.boundingBox();
    expect(alertBox, 'run-alert must have a bounding box').not.toBeNull();
    expect(navBox, 'top nav must have a bounding box').not.toBeNull();
    expect(headerBox, 'page header must have a bounding box').not.toBeNull();

    // The alert's top edge sits BELOW the bottom of the top nav (it flows after the nav,
    // not pinned above it as in XTF-10). Today the fixed bar renders ABOVE the nav, so
    // alertBox.y < navBox bottom → this fails for the right reason.
    expect(
      alertBox!.y,
      `run-alert top (${alertBox!.y}) must be below the top nav bottom (${navBox!.y + navBox!.height})`,
    ).toBeGreaterThanOrEqual(navBox!.y + navBox!.height);

    // …and below the page header (the title bar), not above it.
    expect(
      alertBox!.y,
      `run-alert top (${alertBox!.y}) must be below the page header bottom (${headerBox!.y + headerBox!.height})`,
    ).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);

    // It is NOT a position:fixed viewport-pinned bar, and not glued to the very top of
    // the viewport. (XTF-10's bar was a fixed/top full-bleed element.)
    const cssPosition = await alert.evaluate((el) => getComputedStyle(el).position);
    expect(cssPosition, 'run-alert must NOT be position:fixed (in-flow, scrolls with content)').not.toBe('fixed');
    expect(
      alertBox!.y,
      'run-alert must not be pinned to the very top of the viewport',
    ).toBeGreaterThan(0);

    // Robust DOM-relationship check: the alert is NOT a direct child of the top-level
    // `.layout` container rendered before the header — it lives deeper in the content
    // tree. In XTF-10 the alert is a direct child of `.layout`; after XTF-14 it is not.
    const isDirectLayoutChild = await alert.evaluate((el) => {
      const layout = el.closest('.layout');
      return !!layout && el.parentElement === layout;
    });
    expect(isDirectLayoutChild, 'run-alert must NOT be a direct child of .layout (it moved into the content flow)').toBe(false);

    // Visual baseline of the in-page run alert (3 viewports via playwright.config.ts).
    // The implementer regenerates the baselines for human re-approval — the layout
    // changed from a fixed top bar to an in-page content-width block.
    await expect(page).toHaveScreenshot('run-alert.png');

    // ── NEW (XTF-14): Stop is an ICON button — a real <button> with NO visible "Stop"
    // text but WITH a non-empty accessible name. ─────────────────────────────────────
    const stopBtn = page.getByTestId('run-stop');
    await expect(stopBtn).toBeVisible();
    expect((await stopBtn.evaluate((el) => el.tagName)).toLowerCase(), 'run-stop must be a <button>').toBe('button');

    // No visible "Stop" text — the trimmed rendered text content is empty (icon-only).
    const visibleText = (await stopBtn.evaluate((el) => (el as HTMLElement).innerText || '')).trim();
    expect(visibleText, `run-stop must be an icon button with no visible text, saw: ${JSON.stringify(visibleText)}`).toBe('');
    await expect(stopBtn).not.toContainText(/stop/i);

    // …but it carries an accessible name via aria-label.
    const ariaLabel = (await stopBtn.getAttribute('aria-label')) || '';
    expect(ariaLabel.trim().length, 'run-stop must have a non-empty aria-label (accessible name)').toBeGreaterThan(0);

    // PRESERVED (XTF-10): clicking Stop POSTs to /api/stop/{run_id} with the run_id from
    // the SSE frame.
    await stopBtn.click();
    await expect.poll(() => stopCalls.length).toBeGreaterThan(0);
    expect(stopCalls.some((p) => p === `/api/stop/${RUN_ID}`),
      `expected POST /api/stop/${RUN_ID}, saw: ${JSON.stringify(stopCalls)}`).toBeTruthy();

    // PRESERVED (XTF-10): the View logs control toggles the bottom terminal open.
    const term = page.locator('.bottom-term');
    const wasOpen = await term.getAttribute('data-open');
    await page.getByTestId('run-alert').getByRole('button', { name: /view logs/i }).click();
    await expect.poll(async () => term.getAttribute('data-open')).not.toBe(wasOpen);

    // PRESERVED (XTF-10): when the run ends (terminal status), the alert disappears.
    await page.evaluate(() => {
      (window as any).__runStream.push({ event: 'status', command: 'build-report', status: 'success' });
      (window as any).__runStream.close();
    });
    await expect(page.getByTestId('run-alert')).toHaveCount(0);
  });
});
