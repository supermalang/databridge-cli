# Performance — archived (delivered) cards

> Full history also in git. Live roadmap keeps only the ledger row.

- [x] **PERF-4 — Client-side stale-while-revalidate cache (instant UI on reload / project-switch / refresh) (P2)**

  **Created:** 2026-06-27 · **Completed:** 2026-06-27

  Follow-up to PERF-1/2 (server cache) + PERF-3 (skeletons). Keep-alive panes already make
  *within-session* tab revisits instant, but a **full reload / cold start / re-login**, a
  **project switch**, and the hourly / `databridge:data-changed` epoch bump all remount and
  refetch from scratch (skeleton every time). Add a client-side **stale-while-revalidate** cache:
  render the last-known response **instantly**, revalidate in the background, and only show the
  skeleton on a true cold miss. Two tiers, split by data sensitivity (localStorage is readable by
  any XSS, so secrets/PII must never be persisted):

  - **Persisted tier (localStorage/IndexedDB, per-project namespace):** only small, non-sensitive
    metadata — `/api/state`, `/api/questions`, `/api/templates`, `/api/reports`,
    `/api/data/sessions`, `/api/periods`. Makes hard reloads paint instantly.
  - **In-memory tier only (never written to disk):** `/api/config` (may carry a token),
    `/api/profile`, `/api/data-quality` (column stats can expose data values). Instant on
    within-session revisit, but not across a hard reload.

  **Files:** `frontend/src/lib/cache.js` (new — the SWR cache: `swr(key, fetcher, {persist})` that
  serves cache-then-revalidates, an in-memory map + a localStorage backend gated by a persist
  whitelist, per-active-project namespacing, a `CACHE_VERSION`, a TTL backstop, and
  `clearCache(scope)`) · `frontend/src/lib/auth.js` (wipe the whole cache on logout / `handle401`) ·
  `frontend/src/App.jsx` (clear/namespace on project switch; clear the active project's cache on
  `databridge:data-changed`) · the data-loading sites that should adopt it —
  `frontend/src/pages/{Questions,Reports,Profile,Sources}.jsx` (+ any shared loader in
  `frontend/src/lib/config.js`) wrap their mount fetch in `swr(...)` so a cache hit renders before
  the network resolves (no skeleton on a hit) · `frontend/tests/e2e/client-cache.spec.ts` (new)

  **Config/schema impact:** None — client-side only; no API/DB change (it consumes the same
  endpoints, complementing the PERF-1 server cache).

  **Acceptance criteria**
  - On a **second load** of a tab whose data is cached (e.g. reopen after a reload, for a persisted
    endpoint), the real content renders **without a skeleton flash**, and a background revalidation
    request is still issued (stale-while-revalidate) and updates the view if the data changed
  - **Persisted tier** writes ONLY the whitelisted non-sensitive endpoints to storage; `/api/config`,
    `/api/profile`, `/api/data-quality` are **never** written to disk (asserted) — they use the
    in-memory tier only
  - Cache entries are **namespaced per active project**; switching to project B never serves
    project A's cached data, and switching back to A is instant
  - The cache is **invalidated** on `databridge:data-changed` (post-download / config save) so a
    stale value is never served after the data changes, and is **fully cleared on logout**
  - A `CACHE_VERSION` bump and a TTL backstop prevent indefinitely-stale or schema-mismatched
    entries from being served
  - No correctness regression: a cache miss behaves exactly as today (skeleton → fetch → content)
  - **Security:** no secret or PII value is persisted to browser storage (verified against the
    whitelist + a test that inspects localStorage after loading config/profile)

  **Unit tests:** N/A (frontend-only; Vitest is not installed — the SWR behaviour, the persist
  whitelist, per-project namespacing, and invalidation are asserted by the Playwright E2E below).

  **E2E:** `frontend/tests/e2e/client-cache.spec.ts` (new) — network-mocked: (1) load a tab, reload
  the page, and assert the cached content is visible immediately (before the revalidation response
  is fulfilled) with no skeleton, and that a revalidation request still fires; (2) after loading
  Connection (config) and Profile, assert `localStorage` contains NONE of the config token /
  profile values (sensitivity whitelist holds); (3) trigger `databridge:data-changed` and assert the
  next read refetches (cache invalidated); (4) switch projects and assert project A's cached value
  is not shown for project B. (No `toHaveScreenshot` baseline — behavioural.)

  **UAT:**
  1. Load the app, visit a few tabs, then **hard-reload**. Confirm the previously-seen tabs paint
     instantly (no skeleton), and data still refreshes a moment later.
  2. Switch to another project and back; confirm the return is instant and shows the right project's
     data (never the other project's).
  3. Run a download (or save config); confirm the affected views refresh rather than showing stale
     data.
  4. Log out and back in; confirm no stale data persists across the logout.

  **Verify:** `cd frontend && npx playwright test client-cache.spec.ts`

---

- [x] **PERF-3 — Per-page skeleton loaders for the data-driven tabs (perceived performance)**

  **Created:** 2026-06-26 · **Completed:** 2026-06-26

  A complement to PERF-1/PERF-2 (server-side cache) on the **client** side: today every
  data-driven tab initialises its data to `null` and renders a single centred grey "Loading…"
  line (`.empty-state`, `frontend/src/styles.css` ~176) on first mount — so on a cold load /
  refresh, and on the first visit to each tab, the user sees a blank panel with one line of text
  while the mount fetch is in flight (`Questions.jsx` ~450, `Sources.jsx` ~162, `Profile.jsx`
  ~177, `Reports.jsx` ~185/230, `Validate.jsx` ~177). Replace that plain text with a reusable
  **skeleton** placeholder whose shape approximates the real content, so the interface feels
  responsive and content swaps in without a jarring layout shift. **Perceived-performance / UI
  only — no change to data fetching, the keep-alive pane machinery, or the epoch/remount logic
  (`frontend/src/App.jsx`); only the loading placeholder changes.** Scope is the five tabs that
  currently render a mount-time `null → "Loading…"` state (Questions, Sources, Profile, Reports,
  Validate); on-demand/action loads (Composition previews, Ask) and the app-shell are out of
  scope (possible future cards). Independent of PERF-1/PERF-2 (no server change); independent of
  the OUT/UX/ME/A11Y cards.

  **Files:** `frontend/src/components/Skeleton.jsx` (new — a reusable `<Skeleton>` primitive:
  shimmer block(s) with width/height/variant props, plus small composed layouts the pages reuse;
  the wrapper carries `aria-busy="true"` + a visually-hidden "Loading" label and the shimmer
  blocks are `aria-hidden`) · `frontend/src/styles.css` (a `.skeleton` class + shimmer
  `@keyframes` that respects the existing `@media (prefers-reduced-motion: reduce)` block —
  static placeholder, no shimmer, when reduced motion is set; design-token colours only) ·
  `frontend/src/pages/Questions.jsx` (~450) · `frontend/src/pages/Sources.jsx` (~162) ·
  `frontend/src/pages/Profile.jsx` (~177) · `frontend/src/pages/Reports.jsx` (~185/230) ·
  `frontend/src/pages/Validate.jsx` (~177) — swap the `<p className="empty-state">…loading…</p>`
  branch for a layout-matched skeleton · `frontend/tests/e2e/perf-3-skeleton.spec.ts` (new)

  **Config/schema impact:** None — frontend presentation only; no `config.yml`, DB, or endpoint
  change.

  **Acceptance criteria**
  - A reusable `Skeleton` component exists (`frontend/src/components/Skeleton.jsx`) with a shimmer
    animation driven by tokenised colours; its container exposes `aria-busy="true"` and a
    visually-hidden text label (e.g. "Loading"), and the decorative shimmer blocks are
    `aria-hidden="true"` so assistive tech announces a single loading state, not noise
  - Each of the five mount-loading tabs (Questions, Sources, Profile, Reports, Validate) renders a
    layout-matched skeleton **in place of** the current plain "Loading…" text while its mount
    fetch is in flight — the skeleton's overall shape approximates the real content (so content
    swaps in with no major layout shift)
  - Once the data arrives, the skeleton is fully replaced by the real content; on fetch error the
    existing error/toast path is unchanged (no skeleton left stuck on screen)
  - The skeleton honours `prefers-reduced-motion: reduce` — no shimmer animation under reduced
    motion (a static placeholder is shown instead)
  - **No behaviour change** to data fetching, the keep-alive panes, or the epoch/remount logic —
    only the loading placeholder differs; a returning user (tab already mounted, data cached) sees
    no skeleton on tab switch (the existing keep-alive path is unchanged)
  - Impeccable audit/critique clean on the skeleton states

  **Unit tests:** N/A (frontend-only; Vitest is not installed in this repo — the skeleton
  presence, the reduced-motion behaviour, and the skeleton→content swap are asserted by the
  Playwright E2E below, consistent with the A11Y/PUX cards' coverage approach).

  **E2E:** `frontend/tests/e2e/perf-3-skeleton.spec.ts` (new) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — for at least Questions and Profile: intercept the page's mount fetch
  (`/api/questions`, `/api/profile`) and delay the response, assert the skeleton container
  (`aria-busy="true"` / a `data-testid="skeleton"`) is visible while the request is pending and
  that the plain "Loading…" text is gone; release the response and assert the skeleton is removed
  and the real content is shown. Run a Playwright axe audit on a skeleton state and assert no new
  violations (the busy region is announced once, shimmer blocks are hidden). Emulate
  `prefers-reduced-motion: reduce` and assert the shimmer animation is not applied. Capture
  `toHaveScreenshot` baselines of a Questions skeleton and a Profile skeleton at all three
  viewports (mobile 390×844, tablet 820×1180, desktop 1440×900); a human approves them.

  **UAT:**
  1. With a throttled connection (or a cold project), open the app and visit Questions, Sources,
     Profile, Reports, and Validate for the first time. Confirm each shows a skeleton that
     resembles its eventual layout — not a blank panel with one line of text — and that the real
     content then replaces the skeleton without the page jumping.
  2. Switch away from a tab you've already loaded and back again. Confirm it appears instantly with
     no skeleton (keep-alive unchanged).
  3. Enable "reduce motion" in your OS/browser and reload. Confirm the skeletons are static (no
     shimmer) but still present.
  4. With a screen reader on, load a tab and confirm it announces a single "loading/busy" state
     rather than reading out each placeholder block.

  **Verify:** `cd frontend && npx playwright test perf-3-skeleton.spec.ts`

---

- [x] **PERF-2 — Shared (cross-worker) cache backend for the perf cache**

  **Created:** 2026-06-20 · **Completed:** 2026-06-25

  Follow-up to PERF-1 (shipped: an in-process dict cache in `web/perf_cache.py` fronting
  `/api/profile`, `/api/data-quality`, `/api/base-tables`, invalidated on config-save and
  download-completion). PERF-1's cache is a module-level dict living inside ONE process, so under
  multi-worker uvicorn (`--workers N`) each worker keeps its own copy: (a) a given view warms up to N
  times (once per worker) before all workers are fast, and (b) an `invalidate()` only clears the
  worker that handled the request. **This is a performance/scale improvement, NOT a correctness fix:**
  (b) is harmless today because the cache key embeds a config+data fingerprint that changes on
  save/download, so stale entries are simply never looked up again — they are inert until the process
  restarts. PERF-2 makes the cache backend **pluggable** so it can use a shared out-of-process store
  (Redis) when configured, falling back to the current in-process dict when not — fewer cold
  recomputes across workers + global invalidation, with zero new infrastructure for single-worker
  deployments. Depends on **PERF-1** (shipped); independent of the OUT/UX/ME cards.

  **Files:** `web/perf_cache.py` (introduce a backend abstraction behind the existing
  `get_or_compute`/`invalidate`/`fingerprint` surface: an in-process dict backend as the default and a
  shared Redis backend selected when a connection URL is configured) · `tests/test_perf_cache_shared.py`
  (new) · the new optional env var (`REDIS_URL` / `PERF_CACHE_URL`) added to the env-vars table in
  `CLAUDE.md` and to `.env.example` · `requirements.txt` (Redis client) and `requirements-dev.txt`
  (`fakeredis`, dev/test only) if the shared backend / its test double are used. PERF-1's existing
  `tests/test_perf_cache.py` must keep passing unchanged against the default backend.

  **Config/schema impact:** None to `config.yml`; adds one **optional** env var
  (`REDIS_URL` / `PERF_CACHE_URL`). When unset, behavior is identical to PERF-1 (in-process dict);
  no new infrastructure required for single-worker deployments.

  **Acceptance criteria**
  - `web/perf_cache.py` gains a backend abstraction: the existing in-process dict is the **default**
    backend; a shared backend (Redis) is selected when a connection is configured via the env var
    (`REDIS_URL` / `PERF_CACHE_URL`). With the env var unset, behavior is identical to PERF-1
  - The public surface `get_or_compute` / `invalidate` / `fingerprint` is **unchanged** — only the
    storage behind it changes; PERF-1's frozen `tests/test_perf_cache.py` still passes against the
    default backend
  - With the shared backend configured, a value cached by one worker is readable by another (simulated
    in tests by two backend instances pointed at the same store, e.g. `fakeredis`), and
    `invalidate(org, project)` clears it for **all** instances/workers
  - Per-project namespacing and the config+data fingerprint key are preserved **exactly** (no
    correctness change to what counts as a cache hit)
  - **Graceful degradation:** if the shared store is configured but unreachable at request time, the
    endpoints still serve correct results by computing directly (the cache becomes a no-op) rather than
    erroring — a cache outage must never take down `/api/profile` etc.

  **Unit tests:** `tests/test_perf_cache_shared.py` — (1) `test_default_backend_matches_perf1`: with
  no URL set, `get_or_compute`/`invalidate`/`fingerprint` behave identically to PERF-1 (in-process
  dict; warm call skips recompute, fingerprint stable-then-changes). (2)
  `test_shared_backend_cross_worker_hit`: two shared-backend instances over one fake store (`fakeredis`
  or an in-memory double) share reads — a value written by instance A is returned to instance B without
  recomputing. (3) `test_shared_invalidate_clears_all`: `invalidate(org, project)` on one instance
  clears the entry seen by the other. (4) `test_namespacing_and_fingerprint_unchanged`: per-project
  namespacing + the config+data fingerprint key are byte-for-byte the same as PERF-1 (a different
  project / changed fingerprint misses). (5) `test_shared_store_unreachable_falls_back`: with the store
  configured but unreachable, `get_or_compute` computes directly and returns the correct value without
  raising (cache no-ops). Use `fakeredis` (a new dev dependency) or an in-memory double so no real
  Redis is needed in CI.

  **E2E:** N/A (no UI surface — server-side cache backend; the three endpoints' UI consumers are
  unchanged and already covered elsewhere).

  **UAT:** N/A (back-end performance/scale change, no UI surface of its own — verified via the Verify
  command, the unit tests, the verifier, and PR review; UAT moves in lockstep with E2E).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_perf_cache_shared.py`

---

- [x] **PERF-1 — Cache the expensive read-only server computations on a (data-session + config) fingerprint**

  **Created:** 2026-06-20 · **Completed:** 2026-06-20

  Add a server-side cache layer in front of the three heavy read-only endpoints (`/api/profile`,
  `/api/data-quality`, `/api/base-tables`) keyed on a fingerprint of the **active project's data
  session + config**. Identical repeat requests (the common case when a user navigates back and forth
  between tabs) return the memoized result instead of re-running `load_processed_data` /
  `profile_dataset` / `compute_data_quality`. The fingerprint changes — invalidating the cache — when
  new data is downloaded (download completion) or the config is saved (`POST /api/config`), so a stale
  result is never served. Caching is **per project** so one project's cached result is never returned
  for another. This is the server-side caching deliverable only (the client query-cache and
  background-prefetch ideas are out of scope; see the section intro). Depends on **XTF-1–XTF-24** /
  **VIS-1** (shipped); independent of the OUT/UX/ME cards.

  **Files:** `web/perf_cache.py` (new — the fingerprint + cache helper: `fingerprint(org_id,
  project_id, cfg, session)` over the active data-session identity + a config hash; a per-project
  `get_or_compute(key, compute_fn)` keyed store with an explicit `invalidate(org_id, project_id)`) ·
  `web/main.py` (the three endpoints `/api/profile` ~2355, `/api/data-quality` ~2369,
  `/api/base-tables` ~2313 wrap their compute in `perf_cache.get_or_compute`; the `POST /api/config`
  save handler and the download-completion path call `perf_cache.invalidate` for the active
  org/project) · `tests/test_perf_cache.py` (new)

  **Config/schema impact:** None — in-process caching only; no `config.yml` field, no DB/schema change.

  **Acceptance criteria**
  - A cache helper computes a fingerprint from the active project's **data-session identity + a hash
    of the config**; two requests with the same fingerprint hit the cache, a changed fingerprint
    misses and recomputes
  - On a **cold** cache, `/api/profile`, `/api/data-quality`, and `/api/base-tables` each return a
    result **byte-identical** to the current (un-cached) implementation — correctness is preserved
  - On a **warm** second call with an unchanged fingerprint, the underlying heavy function
    (`load_processed_data` / `profile_dataset` / `compute_data_quality`) is **not** invoked again
    (the memoized value is returned) — provable by a call-count spy on the heavy functions
  - Saving config via `POST /api/config` invalidates the cache for that project, so the next
    `/api/profile` (etc.) recomputes rather than serving the pre-save result
  - Completing a `download` invalidates the cache for that project, so post-download reads reflect the
    new data, never the pre-download cached result
  - **Per-project isolation:** a cache entry computed for project A is never returned for a request
    scoped to project B (distinct fingerprints / namespacing by org+project)

  **Unit tests:** `tests/test_perf_cache.py` — (1) `test_fingerprint_stable_then_changes`: the
  fingerprint is identical for the same (session, config) and changes when the config hash or the
  data-session identity changes. (2) `test_warm_call_skips_recompute`: wrap a spy compute fn in
  `get_or_compute`; first call invokes it once, a second call with the same key returns the cached
  value WITHOUT invoking the spy again (assert call count == 1). (3) `test_cold_result_matches_uncached`:
  for each of profile / data-quality / base-tables, the cached path returns a value byte-identical to
  calling the underlying function directly on a fixture session (correctness preserved). (4)
  `test_config_save_invalidates`: after `invalidate(org, project)` (the hook `POST /api/config` calls),
  the next `get_or_compute` re-invokes the compute fn. (5) `test_download_invalidates`: simulate the
  download-completion invalidation hook and assert the next read recomputes. (6)
  `test_per_project_isolation`: a value cached under (orgA, projA) is not returned for (orgB, projB) —
  the second project misses and computes its own. Fixtures use the suite's existing
  SQLite + local-storage self-provisioning (no Postgres/Minio).

  **E2E:** N/A (no UI surface — server-side caching; the three endpoints' UI consumers are unchanged
  and already covered elsewhere).

  **UAT:** N/A (back-end performance fix, no UI surface of its own — verified via the Verify command,
  the unit tests, the verifier, and PR review; UAT moves in lockstep with E2E).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_perf_cache.py`

---

