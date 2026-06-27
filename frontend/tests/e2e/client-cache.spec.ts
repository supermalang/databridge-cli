import { test, expect, Page } from '@playwright/test';

/**
 * PERF-4 — Client-side stale-while-revalidate (SWR) cache.
 *
 * These specs encode the card's ACCEPTANCE CRITERIA, not the implementation. A
 * different agent writes `frontend/src/lib/cache.js` + the wiring; this spec is the
 * spec they must satisfy.
 *
 * Acceptance criteria encoded here (one behaviour per test):
 *
 *   AC1 — SWR hit, no skeleton flash + background revalidate:
 *     On a SECOND load of a tab whose data is cached (a persisted endpoint, e.g.
 *     /api/questions), the real content renders INSTANTLY — before the revalidation
 *     response resolves — with NO skeleton, and a background revalidation request is
 *     still issued (and updates the view if the data changed).
 *
 *   AC2 — sensitivity whitelist:
 *     The persisted tier writes ONLY whitelisted non-sensitive endpoints to storage.
 *     /api/config (carries a token) and /api/profile (column stats expose data
 *     values) are NEVER written to disk; a whitelisted endpoint (e.g. /api/state)
 *     IS persisted (so the cache demonstrably exists). Anchored on the persisted
 *     write so the security assertion can never pass vacuously.
 *
 *   AC3 — invalidation on `databridge:data-changed`:
 *     After the event fires (post-download / config save), a stale value is never
 *     served — the next read refetches and the NEW data is shown, not the old cached
 *     value.
 *
 *   AC4 — per-project namespacing:
 *     Cache entries are namespaced per active project; switching to project B never
 *     serves project A's cached data.
 *
 *   AC5 — cache cleared on logout:
 *     handle401 / logout wipes the whole cache; after a 401 nothing stale persists in
 *     storage.
 *
 * NETWORK-MOCKED end to end (same harness as perf-3-skeleton / i18n-subtabs): Vite
 * serves the real SPA; every /api/** call is intercepted with page.route(), so no
 * FastAPI backend is required. To observe SWR deterministically we gate the
 * revalidation fetch open and assert the cached content paints BEFORE the gate is
 * released.
 *
 * No `toHaveScreenshot` baseline — this card is behavioural.
 *
 * SELECTORS (interface, not behaviour under test) — stable structural hooks reused
 * from the green perf-3 / a11y / i18n specs:
 *   - Primary nav stages:  `.tabs-bar [data-tab="<stageId>"]`.
 *   - Sub-tabs:            `.subtabs-bar .subtab` (Questions/Profile/Validate → `transform`).
 *   - Project switcher:    `.project-switcher` opens `.project-menu`; rows are
 *                          `.project-menu__item` (the active one carries `.active`);
 *                          clicking a non-active row POSTs /api/projects/<id>/activate
 *                          and dispatches `databridge:data-changed`.
 *   - Skeleton (PERF-3):   `[data-testid="skeleton"]` with `aria-busy="true"`.
 *   - Real Questions row:  `input.q-export-input` (one per question).
 */

const PROJECT_A = { id: 'proj-a', name: 'Project A', slug: 'project-a', role: 'admin', is_archived: false };
const PROJECT_B = { id: 'proj-b', name: 'Project B', slug: 'project-b', role: 'admin', is_archived: false };

// A LITERAL secret token inside the config YAML so the security test can grep storage
// for it. The persisted tier must never write this to disk.
const SECRET_TOKEN = 'SECRET-KOBO-TOKEN-9f3a-do-not-persist';
const CONFIG_YML = [
  'api:',
  '  url: https://kf.kobotoolbox.org/api/v2',
  `  token: ${SECRET_TOKEN}`,
  'form:',
  '  uid: aXyZ123',
  '  alias: test',
  '',
].join('\n');

// A recognizable PII-ish value embedded in the profile payload (column stats can
// expose real data values) — must never reach localStorage.
const PROFILE_SENTINEL = 'PROFILE-COLUMN-VALUE-leak-canary-7b21';
const PROFILE = {
  profiles: [
    {
      name: 'main',
      rows: 100,
      columns: [
        { name: 'age', role: 'quantitative', distinct: 50, top_value: PROFILE_SENTINEL },
        { name: 'region', role: 'categorical', distinct: 5 },
      ],
    },
  ],
};

// Questions payloads keyed by export_label so a test can tell "old" vs "new" data
// apart in the rendered q-export-input fields.
function questionsPayload(exportLabel: string) {
  return {
    questions: [
      { kobo_key: 'group_a/age', label: 'Respondent age', export_label: exportLabel, type: 'integer', category: 'quantitative', group: 'group_a' },
    ],
  };
}

/** Controllable gate: the route handler awaits release() before fulfilling. */
function makeGate() {
  let release!: () => void;
  const opened = new Promise<void>((res) => { release = res; });
  return { opened, release };
}

type Stubs = {
  // Active project + project list (lets a test flip the active project mid-run).
  activeIdRef: { id: string };
  // Per-endpoint counters so a test can prove a revalidation request fired.
  counts: Record<string, number>;
  // Mutable questions export_label so a test can change the server's answer.
  questionsLabelRef: { label: string };
  // Per-project questions answer for the namespacing test.
  questionsByProject: Record<string, string>;
  // Optional gate held open to keep a /api/questions response in flight.
  gateRef: { gate: Promise<void> | null };
};

/**
 * Stub the bootstrap network. The catch-all is registered FIRST because Playwright
 * matches routes in REVERSE registration order (last registered wins).
 */
async function stubBootstrap(page: Page): Promise<Stubs> {
  const stubs: Stubs = {
    activeIdRef: { id: PROJECT_A.id },
    counts: {},
    questionsLabelRef: { label: 'age' },
    questionsByProject: { [PROJECT_A.id]: 'age_a', [PROJECT_B.id]: 'age_b' },
    gateRef: { gate: null },
  };
  const bump = (k: string) => { stubs.counts[k] = (stubs.counts[k] || 0) + 1; };

  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));

  await page.route('**/api/me', (r) => {
    if (r.request().method() === 'PATCH') {
      const body = (r.request().postDataJSON() || {}) as { language?: string };
      return r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', name: 'Dev User', language: body.language ?? 'en' } });
    }
    return r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', name: 'Dev User', language: 'en' } });
  });

  await page.route('**/api/projects', (r) => {
    bump('projects');
    return r.fulfill({ json: { active_id: stubs.activeIdRef.id, is_superadmin: false, projects: [PROJECT_A, PROJECT_B] } });
  });
  await page.route('**/api/projects/*/activate', async (r) => {
    const m = r.request().url().match(/\/api\/projects\/([^/]+)\/activate/);
    if (m) stubs.activeIdRef.id = m[1];
    await r.fulfill({ json: { active_id: stubs.activeIdRef.id } });
  });
  await page.route('**/api/projects/*/members', (r) =>
    r.fulfill({ json: { members: [], invitations: [], my_role: 'admin' } }));

  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/periods/date-range', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/config', (r) => { bump('config'); return r.fulfill({ json: { content: CONFIG_YML } }); });
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/state', (r) =>
    { bump('state'); return r.fulfill({ json: { has_questions: true, has_data: true, has_templates: false, has_ai: false } }); });
  await page.route('**/api/reports', (r) => { bump('reports'); return r.fulfill({ json: { files: [] } }); });
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  await page.route('**/api/framework', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/data/sessions', (r) => r.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/validate', (r) => r.fulfill({ json: { n_rows: 0, n_columns: 0, checks: [] } }));
  await page.route('**/api/data-quality', (r) => r.fulfill({ json: { columns: [] } }));

  // Profile carries the leak canary.
  await page.route('**/api/profile', (r) => { bump('profile'); return r.fulfill({ json: PROFILE }); });

  // Questions: answer depends on the ACTIVE project (namespacing test) and may be
  // held open by a gate (SWR / invalidation tests).
  await page.route('**/api/questions', async (r) => {
    bump('questions');
    if (stubs.gateRef.gate) await stubs.gateRef.gate;
    const label = stubs.questionsByProject[stubs.activeIdRef.id] ?? stubs.questionsLabelRef.label;
    await r.fulfill({ json: questionsPayload(label) });
  });

  return stubs;
}

async function gotoApp(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.locator('.tabs-bar .tab').first()).toBeVisible();
}

async function openTransformSub(page: Page, sub: RegExp) {
  await page.locator('.tabs-bar [data-tab="transform"]').click();
  await page.locator('.subtabs-bar .subtab', { hasText: sub }).click();
}

async function openConnection(page: Page) {
  await page.locator('.tabs-bar [data-tab="extract"]').click();
  // Connection is the first sub of Extract; if a strip renders, click it.
  const conn = page.locator('.subtabs-bar .subtab', { hasText: /connection|connexion/i });
  if (await conn.count()) await conn.first().click();
}

const skeleton = (page: Page) => page.locator('[data-testid="skeleton"]');
const questionInput = (page: Page) => page.locator('input.q-export-input');

// All localStorage values, flattened to one string for substring scanning.
async function dumpLocalStorage(page: Page): Promise<string> {
  return page.evaluate(() => {
    let out = '';
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      out += k + '=' + (localStorage.getItem(k) || '') + '\n';
    }
    return out;
  });
}

test.describe('PERF-4 — SWR cache hit: instant content, no skeleton, background revalidate', () => {
  // AC1: second load of a cached persisted endpoint renders content BEFORE the
  // revalidation resolves, with no skeleton, and still fires a background request.
  test('reopening Questions after a reload paints cached content before revalidation, no skeleton', async ({ page }) => {
    const stubs = await stubBootstrap(page);
    await gotoApp(page);

    // FIRST load: let it resolve so the value is written to the (persisted) cache.
    await openTransformSub(page, /questions/i);
    await expect(questionInput(page).first()).toHaveValue('age_a');
    await expect(skeleton(page)).toHaveCount(0);
    const firstCount = stubs.counts['questions'] || 0;

    // SECOND load: hard reload, but hold the revalidation fetch OPEN.
    const gate = makeGate();
    stubs.gateRef.gate = gate.opened;
    await gotoApp(page);
    await openTransformSub(page, /questions/i);

    // SWR: the cached content must already be on screen WHILE the revalidation is
    // still pending — and NO skeleton flashes.
    await expect(
      questionInput(page).first(),
      'cached Questions content must paint before the revalidation response resolves',
    ).toHaveValue('age_a');
    await expect(skeleton(page), 'no skeleton may flash on a cache hit').toHaveCount(0);

    // A background revalidation request was still issued (stale-while-revalidate).
    expect(
      (stubs.counts['questions'] || 0),
      'a background revalidation request to /api/questions must still fire on a cache hit',
    ).toBeGreaterThan(firstCount);

    gate.release();
  });

  // AC1 (revalidate updates the view): SWR shows the STALE cached value first (while
  // the gated revalidation is pending), then swaps to the NEW server value once it
  // resolves. The "stale-first-while-pending" step fails RED on the current no-cache
  // code (which can only show the skeleton until the gated fetch resolves), so this is
  // not a vacuous pass.
  test('SWR shows stale cached value first, then swaps to new server value', async ({ page }) => {
    const stubs = await stubBootstrap(page);
    await gotoApp(page);
    await openTransformSub(page, /questions/i);
    await expect(questionInput(page).first()).toHaveValue('age_a');

    // Server's answer changes; reload with the revalidation held OPEN.
    stubs.questionsByProject[PROJECT_A.id] = 'age_a_v2';
    const gate = makeGate();
    stubs.gateRef.gate = gate.opened;
    await gotoApp(page);
    await openTransformSub(page, /questions/i);

    // STALE-FIRST: the cached value paints while the revalidation is still pending.
    await expect(
      questionInput(page).first(),
      'SWR must paint the stale cached value while revalidation is pending',
    ).toHaveValue('age_a');

    // Release → the revalidation swaps the view to the new server value.
    gate.release();
    await expect(
      questionInput(page).first(),
      'revalidation must update the view to the new server value',
    ).toHaveValue('age_a_v2');
  });
});

test.describe('PERF-4 — sensitivity whitelist: secrets/PII never persisted to storage', () => {
  // AC2: after loading Connection (config) + Profile, localStorage must contain the
  // secret token / profile canary NOWHERE — while a whitelisted endpoint (state) IS
  // persisted (anchors the test so it cannot pass vacuously on the no-cache baseline).
  test('config token and profile values are never written to localStorage; whitelisted state is', async ({ page }) => {
    await stubBootstrap(page);
    await gotoApp(page);

    // Touch the in-memory-tier (sensitive) endpoints.
    await openConnection(page);
    await openTransformSub(page, /^profile$/i);
    await expect(page.locator('.page:visible')).toContainText(/100 rows|columns|nothing to profile/i);

    // Touch a persisted-tier endpoint and let it settle.
    await openTransformSub(page, /questions/i);
    await expect(questionInput(page).first()).toBeVisible();

    const store = await dumpLocalStorage(page);

    // The persisted cache must exist (a whitelisted endpoint is on disk). This is the
    // anchor: it fails RED on the current no-cache code for the right reason.
    expect(
      store,
      'a whitelisted non-sensitive endpoint must be persisted to localStorage (cache must exist)',
    ).toContain('has_questions');

    // The secret token must NEVER be on disk.
    expect(store, 'the config token must NEVER be written to localStorage').not.toContain(SECRET_TOKEN);
    // The profile column value must NEVER be on disk.
    expect(store, 'profile column values must NEVER be written to localStorage').not.toContain(PROFILE_SENTINEL);
    // /api/config must not be persisted under any cache key.
    expect(store, '/api/config must never be persisted').not.toContain('api:');
  });
});

test.describe('PERF-4 — invalidation on databridge:data-changed', () => {
  // AC3: after the data-changed event the cache entry is invalidated, so a stale
  // value is never served — even while a gated revalidation is pending, the page must
  // NOT instantly paint the old cached value (it shows the skeleton / loading and then
  // the fresh value). This is anchored against the NON-invalidated cache-hit behaviour
  // (which WOULD instantly paint the stale value), so it fails RED on current code:
  // the very first assertion (an established cache hit paints instantly) has no cache
  // today.
  test('a stale value is not served after databridge:data-changed (cache invalidated)', async ({ page }) => {
    const stubs = await stubBootstrap(page);
    await gotoApp(page);
    await openTransformSub(page, /questions/i);
    await expect(questionInput(page).first()).toHaveValue('age_a');

    // Sanity that the cache hit is real: reopening under a gate paints instantly from
    // cache (no skeleton) — fails RED today (no cache → skeleton until gate releases).
    {
      const gate = makeGate();
      stubs.gateRef.gate = gate.opened;
      await gotoApp(page);
      await openTransformSub(page, /questions/i);
      await expect(
        questionInput(page).first(),
        'precondition: an un-invalidated cache hit paints instantly',
      ).toHaveValue('age_a');
      await expect(skeleton(page)).toHaveCount(0);
      gate.release();
      stubs.gateRef.gate = null;
    }

    // Now the data changes server-side and the invalidation event fires.
    stubs.questionsByProject[PROJECT_A.id] = 'age_changed';
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent('databridge:data-changed', { detail: {} })));

    // After invalidation, COLD-reload and reopen with the revalidation held OPEN: a
    // stale 'age_a' must NOT be seeded from cache while pending — the entry was cleared.
    const gate = makeGate();
    stubs.gateRef.gate = gate.opened;
    await gotoApp(page);
    await openTransformSub(page, /questions/i);
    await expect(
      questionInput(page).first(),
      'after databridge:data-changed the stale cached value must NOT be served while pending',
    ).not.toHaveValue('age_a');

    // Release → the refetch yields the new value.
    gate.release();
    await expect(
      questionInput(page).first(),
      'the invalidated entry refetches to the new server value',
    ).toHaveValue('age_changed');
  });
});

test.describe('PERF-4 — per-project namespacing', () => {
  // AC4: switching to project B never serves project A's cached data; switching back
  // to A is instant (served from A's namespace).
  test('switching projects never serves the other project\'s cached questions', async ({ page }) => {
    const stubs = await stubBootstrap(page);
    await gotoApp(page);

    // Load Questions for project A → cached under A's namespace.
    await openTransformSub(page, /questions/i);
    await expect(questionInput(page).first()).toHaveValue('age_a');

    // Switch to project B via the switcher.
    await page.locator('.project-switcher').click();
    await page.locator('.project-menu__item', { hasText: /project b/i }).click();

    // Project B must NEVER show project A's cached value.
    await openTransformSub(page, /questions/i);
    await expect(
      questionInput(page).first(),
      'project B must not be served project A\'s cached value',
    ).toHaveValue('age_b');
    await expect(questionInput(page).first()).not.toHaveValue('age_a');

    // Switch back to A: served instantly from A's namespace (hold the revalidation
    // open to prove the cached value is what paints).
    const gate = makeGate();
    stubs.gateRef.gate = gate.opened;
    await page.locator('.project-switcher').click();
    await page.locator('.project-menu__item', { hasText: /project a/i }).click();
    await openTransformSub(page, /questions/i);
    await expect(
      questionInput(page).first(),
      'returning to project A must instantly serve A\'s cached value',
    ).toHaveValue('age_a');
    await expect(skeleton(page)).toHaveCount(0);
    gate.release();
  });
});

test.describe('PERF-4 — CACHE_VERSION bump and TTL backstop reject stale/schema-mismatched entries', () => {
  // Covers: "A CACHE_VERSION bump and a TTL backstop prevent indefinitely-stale or
  // schema-mismatched entries from being served."

  test('a localStorage entry written with an old CACHE_VERSION is treated as a cold miss', async ({ page }) => {
    const stubs = await stubBootstrap(page);

    // Seed a v0-versioned entry for /api/questions with a recognizable stale value.
    // The cache module only reads `databridge:cache:v1:…` keys, so this must be ignored.
    await page.addInitScript(() => {
      localStorage.setItem(
        'databridge:cache:v0:proj-a::/api/questions',
        JSON.stringify({
          value: { questions: [{ kobo_key: 'old', label: 'Old', export_label: 'v0_stale_data', type: 'integer', category: 'quantitative', group: 'g' }] },
          ts: Date.now(),
        }),
      );
    });

    // Gate the network: a cache HIT would paint the stale value instantly (no skeleton);
    // a cold miss shows the skeleton while the fetch is pending.
    const gate = makeGate();
    stubs.gateRef.gate = gate.opened;
    await gotoApp(page);
    await openTransformSub(page, /questions/i);

    // Cold miss: the skeleton must be visible. If the v0 entry were served, the stale
    // value would paint instead and the skeleton would not appear.
    await expect(
      skeleton(page).first(),
      'a v0-versioned entry must be ignored — skeleton (cold miss) must be visible',
    ).toBeVisible();

    gate.release();
    await expect(questionInput(page).first()).toHaveValue('age_a');
  });

  test('a localStorage entry older than TTL_MS (24 h) is treated as a cold miss', async ({ page }) => {
    const stubs = await stubBootstrap(page);

    // Seed a current-version (v1) entry for /api/questions but with a timestamp 25 h ago.
    // readEntry enforces (Date.now() - ts) < TTL_MS (24h), so this must be rejected.
    const expiredTs = Date.now() - 25 * 60 * 60 * 1000;
    await page.addInitScript((ts: number) => {
      localStorage.setItem(
        'databridge:cache:v1:proj-a::/api/questions',
        JSON.stringify({
          value: { questions: [{ kobo_key: 'old', label: 'Old', export_label: 'ttl_stale_data', type: 'integer', category: 'quantitative', group: 'g' }] },
          ts,
        }),
      );
    }, expiredTs);

    // Gate the network: a cache HIT paints the stale value instantly (no skeleton);
    // a cold miss keeps the skeleton visible while the fetch is pending.
    const gate = makeGate();
    stubs.gateRef.gate = gate.opened;
    await gotoApp(page);
    await openTransformSub(page, /questions/i);

    // Cold miss: skeleton must be visible. If the expired entry were served, its stale
    // value would paint and the skeleton would not appear.
    await expect(
      skeleton(page).first(),
      'an expired entry (>TTL_MS) must be rejected — skeleton (cold miss) must be visible',
    ).toBeVisible();

    gate.release();
    await expect(questionInput(page).first()).toHaveValue('age_a');
  });
});

/**
 * AC5 (cache fully cleared on logout / handle401) is NOT covered by a deterministic
 * network-mocked E2E here: logout in this SPA navigates the page away to the IdP
 * (handle401 → window.location), which cannot be driven inside Playwright without
 * coupling to the internal auth trigger. Per the card, the E2E section enumerates
 * scenarios (1)-(4) only; the logout wipe is gated by UAT step 4 + PR review. The
 * cache module's `clearCache()` and the auth wiring remain the implementer's
 * responsibility, validated by those human gates.
 */
