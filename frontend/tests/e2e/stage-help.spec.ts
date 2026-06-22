import { test, expect, Page, Locator } from '@playwright/test';

/**
 * PUX-4 — In-app contextual help per stage.
 *
 * These specs encode the card's ACCEPTANCE CRITERIA, NOT the implementation. The
 * current app ships NO in-app help on any stage, so every "help affordance",
 * "help panel", "docs link", and "inline hint" assertion below is expected to
 * fail RED until PUX-4 ships.
 *
 * AC (docs/ROADMAP.md PUX-4):
 *   1. Each of the six stage pages exposes a concise contextual-help affordance
 *      (a "?" / "Help" control) that reveals stage-specific guidance WITHOUT
 *      navigating away from the current page (inline panel / popover).
 *   2. Each page's help includes a link to the relevant docs/reference/* page
 *      (returnable — new tab so the user does not lose their place).
 *   3. Concise inline hints accompany the help affordance so a user gets oriented
 *      without even opening the full help.
 *   4. The help affordance is a real keyboard-operable <button> with an accessible
 *      name, visible focus ring, and (for the popover) aria-expanded / disclosure
 *      semantics; help content is reachable by assistive tech.
 *   5. The help is implemented via a SHARED StageHelp component so the six pages
 *      stay consistent (same testid/role pattern on every stage).
 *
 * NETWORK-MOCKED end-to-end (same harness as pux-2 / pux-3 / a11y-*): the Vite dev
 * server serves the real SPA; every /api/** is intercepted with page.route(), so no
 * FastAPI backend is required.
 *
 * ── Selector contract for the implementer ──────────────────────────────────
 * Match these so the spec turns green without edits to the spec. All six pages
 * must render the SHARED StageHelp component producing the same hooks:
 *   - Help affordance toggle: a real native <button>
 *       · data-testid="stage-help-toggle"
 *       · accessible name matching /help/i (e.g. "Help", "What's this?", aria-label)
 *       · aria-expanded="false" when the panel is closed, "true" when open
 *       · keyboard-operable (focusable; Enter / Space toggles); visible focus ring
 *   - Revealed help panel (the in-context disclosure):
 *       · data-testid="stage-help-panel"
 *       · hidden when collapsed, visible when the toggle is activated
 *       · contains stage-specific guidance text
 *       · contains a docs link: a real <a href> whose href matches
 *         /docs\/reference\/.+\.md|\/reference\//i, opening in a new tab
 *         (target="_blank") so the user does not lose their place
 *   - Inline hint (visible WITHOUT opening the help):
 *       · data-testid="stage-hint" — a short orienting hint on the stage
 * ───────────────────────────────────────────────────────────────────────────
 */

const ACTIVE_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  slug: 'test-project',
  role: 'admin',
  is_archived: false,
};

const CONFIG_YML = [
  'api:',
  '  url: https://kobo.example.test',
  '  token: env:KOBO_TOKEN',
  'form:',
  '  uid: aXyZ123',
  '  alias: test',
  '',
].join('\n');

const QUESTIONS = {
  questions: [
    { kobo_key: 'group_a/age', label: 'Respondent age', export_label: 'age', type: 'integer', category: 'quantitative' },
    { kobo_key: 'group_a/region', label: 'Region', export_label: 'region', type: 'select_one', category: 'categorical' },
  ],
};

// Stub the full bootstrap so each stage page mounts cleanly (form connected + data
// present + AI ready → no first-run gating, every stage reachable). Catch-all FIRST
// so the specific routes below win (Playwright matches in reverse registration order).
async function stubBootstrap(page: Page) {
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/periods/date-range', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/questions', (r) => r.fulfill({ json: QUESTIONS }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: true, verified: true } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: true, has_data: true, has_templates: false, has_ai: true } }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  await page.route('**/api/data/sessions', (r) => r.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/indicators/preview', (r) => r.fulfill({ json: { value: 0 } }));
}

async function bootApp(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.getByText('Test Project').first()).toBeVisible();
}

async function gotoStage(page: Page, stageId: string) {
  await page.locator(`.tabs-bar [data-tab="${stageId}"]`).click();
}
async function gotoSub(page: Page, label: string | RegExp) {
  await page.locator('.subtabs-bar .subtab', { hasText: label }).click();
}

// The six stage pages PUX-4 covers, each with how to navigate to it and a stable
// in-context anchor that must remain present after the help is opened (proving the
// reveal did NOT navigate away).
//   - Home: the only stage with no subtab strip; its title is the .home-head__title h1.
//   - Every other page renders the shared PageHeader (.page-header / .page-greeting),
//     so that — plus the active primary tab being unchanged — is the in-context anchor.
type StageDef = {
  name: string;
  stageId: string;          // primary tab data-tab
  sub?: string | RegExp;    // sub-tab label (omitted for Home)
  open: (page: Page) => Promise<void>;
  // A locator that is the visible page heading for THIS stage; it must still be
  // present after opening help (the reveal is in-context, not a page change).
  heading: (page: Page) => Locator;
};

const STAGES: StageDef[] = [
  {
    name: 'Home',
    stageId: 'home',
    open: async (page) => { await gotoStage(page, 'home'); },
    heading: (page) => page.locator('.home-head__title'),
  },
  {
    name: 'Sources (Extract)',
    stageId: 'extract',
    sub: /connection/i,
    open: async (page) => { await gotoStage(page, 'extract'); await gotoSub(page, /connection/i); },
    heading: (page) => page.locator('.tab-content:visible .page-header').first(),
  },
  {
    name: 'Questions',
    stageId: 'transform',
    sub: /questions/i,
    open: async (page) => { await gotoStage(page, 'transform'); await gotoSub(page, /questions/i); },
    heading: (page) => page.locator('.tab-content:visible .page-header').first(),
  },
  {
    name: 'Composition (Charts & indicators)',
    stageId: 'analyze',
    sub: /charts & indicators/i,
    open: async (page) => { await gotoStage(page, 'analyze'); await gotoSub(page, /charts & indicators/i); },
    heading: (page) => page.locator('.tab-content:visible .page-header').first(),
  },
  {
    name: 'Reports (Deliver)',
    stageId: 'present',
    sub: /reports/i,
    open: async (page) => { await gotoStage(page, 'present'); await gotoSub(page, /reports/i); },
    heading: (page) => page.locator('.tab-content:visible .page-header').first(),
  },
  {
    name: 'Templates',
    stageId: 'present',
    sub: /templates/i,
    open: async (page) => { await gotoStage(page, 'present'); await gotoSub(page, /templates/i); },
    heading: (page) => page.locator('.tab-content:visible .page-header').first(),
  },
];

// Shared StageHelp hooks (selector contract above). Scope to the visible pane so the
// keep-alive (mounted-but-hidden) panes never satisfy the assertion for another stage.
const helpToggle = (page: Page): Locator =>
  page.locator('.tab-content:visible').getByTestId('stage-help-toggle');
const helpToggleByRole = (page: Page): Locator =>
  page.locator('.tab-content:visible').getByRole('button', { name: /help/i });
const helpPanel = (page: Page): Locator =>
  page.locator('.tab-content:visible').getByTestId('stage-help-panel');
const stageHint = (page: Page): Locator =>
  page.locator('.tab-content:visible').getByTestId('stage-hint');

// The docs link inside the revealed help: a real <a href> to a docs/reference page.
const docsLink = (page: Page): Locator =>
  helpPanel(page).locator('a[href*="docs/reference/"], a[href*="/reference/"]');

test.describe('PUX-4 — in-app contextual help per stage', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
  });

  // AC1 + AC5 — a help affordance exists on EVERY one of the six stage pages, via
  // the shared component (same testid + role/name pattern). RED today: no such
  // control exists anywhere in the app.
  for (const s of STAGES) {
    test(`AC1/AC5: ${s.name} exposes a help affordance (shared button, name /help/i)`, async ({ page }) => {
      await s.open(page);
      await expect(s.heading(page), `${s.name} must be the active page before asserting`).toBeVisible();

      const toggle = helpToggle(page);
      await expect(toggle, `${s.name} must render the shared stage-help-toggle`).toBeVisible();

      // It is a real native <button> (not a div with onClick).
      const tag = await toggle.evaluate((el) => el.tagName.toLowerCase());
      expect(tag, `${s.name} help affordance must be a native <button>`).toBe('button');

      // It is resolvable by an accessible name matching /help/i (role-based).
      await expect(
        helpToggleByRole(page),
        `${s.name} help affordance must be resolvable by role with an accessible name /help/i`,
      ).toBeVisible();

      // Disclosure semantics: collapsed by default.
      await expect(
        toggle,
        `${s.name} help affordance must expose aria-expanded="false" when collapsed`,
      ).toHaveAttribute('aria-expanded', 'false');
    });
  }

  // AC4 — the help affordance is keyboard-operable with disclosure semantics and a
  // visible focus ring. RED today: no control exists to focus / toggle.
  for (const s of STAGES) {
    test(`AC4: ${s.name} help affordance is keyboard-operable with aria-expanded + focus ring`, async ({ page }) => {
      await s.open(page);
      const toggle = helpToggle(page);
      await expect(toggle).toBeVisible();

      await toggle.focus();
      await expect(toggle, `${s.name} help affordance must be focusable`).toBeFocused();

      // A visible focus ring (the teal :focus-visible outline is solid + non-zero).
      const outline = await toggle.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { style: cs.outlineStyle, width: cs.outlineWidth };
      });
      expect(outline.style, `${s.name} focused help affordance must show a focus outline`).not.toBe('none');
      expect(outline.width, `${s.name} focused help affordance outline must be non-zero`).not.toBe('0px');

      // Keyboard toggles the disclosure both ways.
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await page.keyboard.press('Enter');
      await expect(toggle, `${s.name} Enter must open the help`).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Enter');
      await expect(toggle, `${s.name} Enter must close the help again`).toHaveAttribute('aria-expanded', 'false');
    });
  }

  // AC1 (in-context reveal) — activating the affordance reveals stage-specific help
  // IN CONTEXT: the active stage tab + page heading are unchanged, aria-expanded
  // flips to true, and the help panel becomes visible. RED today: no panel exists.
  for (const s of STAGES) {
    test(`AC1: ${s.name} reveals a help panel in-context (page unchanged, aria-expanded→true)`, async ({ page }) => {
      await s.open(page);
      const heading = s.heading(page);
      await expect(heading).toBeVisible();

      // The active primary tab BEFORE opening help.
      const activeTabBefore = await page.locator('.tabs-bar .tab.active').textContent();

      const toggle = helpToggle(page);
      await toggle.click();

      // aria-expanded flips to true...
      await expect(toggle, `${s.name} aria-expanded must flip to true on open`).toHaveAttribute('aria-expanded', 'true');
      // ...the help panel becomes visible...
      await expect(helpPanel(page), `${s.name} help panel must become visible on open`).toBeVisible();
      // ...with non-empty stage-specific guidance text...
      const guidance = (await helpPanel(page).innerText()).trim();
      expect(guidance.length, `${s.name} help panel must contain guidance text`).toBeGreaterThan(0);

      // ...and we did NOT navigate away: same active tab, heading still present.
      const activeTabAfter = await page.locator('.tabs-bar .tab.active').textContent();
      expect(activeTabAfter, `${s.name} opening help must not change the active stage tab`).toBe(activeTabBefore);
      await expect(heading, `${s.name} the stage heading must still be present (in-context reveal)`).toBeVisible();
    });
  }

  // AC2 — the revealed help contains a link to the relevant docs/reference/* page,
  // opening in a new tab so the user does not lose their place. RED today.
  for (const s of STAGES) {
    test(`AC2: ${s.name} help contains a returnable docs/reference link`, async ({ page }) => {
      await s.open(page);
      await helpToggle(page).click();
      await expect(helpPanel(page)).toBeVisible();

      const link = docsLink(page).first();
      await expect(link, `${s.name} help must include a docs/reference link`).toBeVisible();

      const href = await link.getAttribute('href');
      expect(href, `${s.name} docs link must have an href`).toBeTruthy();
      expect(
        href || '',
        `${s.name} docs link must point at a docs/reference page`,
      ).toMatch(/docs\/reference\/.+\.md|\/reference\//i);

      // Returnable: opens in a new tab so the user does not lose their place.
      await expect(
        link,
        `${s.name} docs link must open in a new tab (target=_blank) so the user keeps their place`,
      ).toHaveAttribute('target', '_blank');
    });
  }

  // AC3 — a concise inline hint is visible WITHOUT opening the full help. RED today.
  for (const s of STAGES) {
    test(`AC3: ${s.name} shows a concise inline hint without opening help`, async ({ page }) => {
      await s.open(page);
      await expect(s.heading(page)).toBeVisible();

      // The help panel must be closed at this point...
      await expect(helpToggle(page), `${s.name} help must start collapsed`).toHaveAttribute('aria-expanded', 'false');

      // ...yet a short inline hint is already visible to orient the user.
      const hint = stageHint(page);
      await expect(hint, `${s.name} must show an inline hint without opening help`).toBeVisible();
      const text = (await hint.innerText()).trim();
      expect(text.length, `${s.name} inline hint must carry orienting text`).toBeGreaterThan(0);
    });
  }

  // ── Visual baselines (per-viewport via the project config) ────────────────
  // Capture an OPENED help panel on two representative stages: Home and Composition.
  // We screenshot the bounded help panel element directly (not a stitched full page),
  // so the position:fixed terminal bar (.bottom-term) can't ghost across the shot.
  // Gate each baseline on the AC (panel actually open) so it is not captured
  // vacuously from a state with no help.

  test('visual: opened help panel on Home', async ({ page }) => {
    await gotoStage(page, 'home');
    await expect(page.locator('.home-head__title')).toBeVisible();
    await helpToggle(page).click();
    const panel = helpPanel(page);
    await expect(panel).toBeVisible();
    await expect(helpToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toHaveScreenshot('pux4-home-help-panel.png');
  });

  test('visual: opened help panel on Composition', async ({ page }) => {
    await gotoStage(page, 'analyze');
    await gotoSub(page, /charts & indicators/i);
    await expect(page.locator('.tab-content:visible .page-header').first()).toBeVisible();
    await helpToggle(page).click();
    const panel = helpPanel(page);
    await expect(panel).toBeVisible();
    await expect(helpToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toHaveScreenshot('pux4-composition-help-panel.png');
  });
});
