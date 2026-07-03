import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * VIS-3 — Cap Playwright workers to stop parallel-worker browser crashes.
 *
 * The three viewport projects (mobile/tablet/desktop) run against one shared
 * Vite dev server. Under `fullyParallel: true` with no worker cap, the
 * headless-chromium workers crash mid-test (`Page crashed` / `Target ...
 * closed`). The fix caps the worker count in `frontend/playwright.config.ts`
 * so specs that pass in isolation also pass in the full suite.
 *
 * These are pure config-contract assertions (no browser, no server). They read
 * the `workers` declaration from `playwright.config.ts` and evaluate its value
 * under both a CI and a non-CI environment, asserting a small, defined worker
 * cap resolves in each — the cap must apply in BOTH because both share one dev
 * server. (The drafted `workers: CI ? 1 : undefined` is explicitly flagged
 * INCOMPLETE because it leaves the local run uncapped.)
 *
 * The `workers` field is the ONLY thing under test here — this card changes
 * runner config, not UI, so there is deliberately no `toHaveScreenshot`
 * baseline (per the card's E2E note).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(HERE, '..', '..');
const CONFIG_PATH = path.join(FRONTEND_DIR, 'playwright.config.ts');

// Extract the RHS expression of the top-level `workers:` key from the config
// source. Returns undefined when the key is absent (the current, uncapped
// state). Deliberately source-based so it evaluates the SAME literal the
// runner uses, without a fragile nested Playwright invocation.
function readWorkersExpr(src: string): string | undefined {
  const m = src.match(/^\s*workers\s*:\s*([^\n]+?),?\s*(?:\/\/.*)?$/m);
  return m ? m[1].trim().replace(/,\s*$/, '') : undefined;
}

// Resolve the effective worker value for a given CI env, by evaluating the
// config's `workers` expression with `process.env.CI` bound to `ciValue`.
function effectiveWorkers(src: string, ciValue: string | undefined): unknown {
  const expr = readWorkersExpr(src);
  if (expr === undefined) return undefined;
  const fakeEnv: Record<string, string | undefined> = { CI: ciValue };
  const fakeProcess = { env: fakeEnv };
  // eslint-disable-next-line no-new-func
  const fn = new Function('process', `"use strict"; return (${expr});`);
  return fn(fakeProcess);
}

function isSmallCap(workers: unknown): boolean {
  return typeof workers === 'number' && Number.isFinite(workers) && workers >= 1 && workers <= 2;
}

// AC: `playwright.config.ts` caps the Playwright worker count so the three
// viewport projects no longer overwhelm the shared Vite dev server. The config
// source must declare a `workers` cap.
test('playwright.config.ts declares a workers cap', () => {
  const src = readFileSync(CONFIG_PATH, 'utf8');
  expect(readWorkersExpr(src)).toBeDefined();
});

// AC: The cap applies in CI (`process.env.CI`).
test('caps the effective worker count to a small fixed number in CI', () => {
  const src = readFileSync(CONFIG_PATH, 'utf8');
  expect(isSmallCap(effectiveWorkers(src, 'true'))).toBe(true);
});

// AC: The cap applies locally too, since both CI and local share one dev
// server. The drafted `workers: CI ? 1 : undefined` fix leaves this branch
// uncapped (undefined → Playwright picks ~half the CPUs), which this forbids.
test('caps the effective worker count to a small fixed number locally (no CI)', () => {
  const src = readFileSync(CONFIG_PATH, 'utf8');
  expect(isSmallCap(effectiveWorkers(src, undefined))).toBe(true);
});
