// Unit tests for useChartPreview — PUX-11.
//
// Acceptance criteria under test (see docs/ROADMAP.md, PUX-11):
//  - Rapid successive field changes within ~600ms fire exactly ONE
//    /api/charts/preview request (debounce collapses bursts).
//  - Loading state is true from request start until the response resolves.
//  - A non-2xx response sets an error state (not loading, not a stale success state).
//
// This hook is required by the card to be extracted so it is unit-testable
// independent of Playwright. No test runner existed yet in frontend/, so this
// file uses Node's built-in `node:test` + a minimal jsdom-backed React render
// harness (jsdom added as a devDependency for this purpose).
//
// Run with:
//   cd frontend && node --test src/hooks/useChartPreview.test.js

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// --- minimal DOM environment so react-dom/client can mount ---------------
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
});
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = React;

// The hook under test. Does not exist yet — this import is expected to fail
// until the implementer creates frontend/src/hooks/useChartPreview.js.
const { useChartPreview } = await import('./useChartPreview.js');

let container;
let root;
let hookState;
let renderCount;

function mountHook(initialChart) {
  renderCount = 0;
  function Harness({ chart }) {
    hookState = useChartPreview(chart);
    renderCount += 1;
    return null;
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  return { Harness };
}

async function renderWithChart(Harness, chart) {
  await act(async () => {
    root.render(React.createElement(Harness, { chart }));
  });
}

function flushMs(ms) {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

let fetchCalls;
let pendingResolvers;
let originalFetch;

beforeEach(() => {
  fetchCalls = [];
  pendingResolvers = [];
  originalFetch = global.fetch;
  global.fetch = (url, opts) => {
    fetchCalls.push({ url, opts });
    return new Promise((resolve, reject) => {
      pendingResolvers.push({ resolve, reject });
    });
  };
});

afterEach(() => {
  global.fetch = originalFetch;
  if (root) {
    try { root.unmount(); } catch { /* ignore */ }
  }
  if (container?.parentNode) {
    container.parentNode.removeChild(container);
  }
});

function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

function errorResponse(status, body = {}) {
  return { ok: false, status, json: async () => body };
}

test('rapid successive field changes within 600ms fire exactly one preview request', async () => {
  const { Harness } = mountHook();
  const chartV1 = { name: 'c1', title: 'Draft', type: 'bar', questions: ['q1'] };
  await renderWithChart(Harness, chartV1);

  // Simulate a user typing a title character-by-character, each keystroke
  // well under the 600ms debounce window.
  const chartV2 = { ...chartV1, title: 'Dra' };
  const chartV3 = { ...chartV1, title: 'Draf' };
  const chartV4 = { ...chartV1, title: 'Draft!' };

  await renderWithChart(Harness, chartV2);
  await flushMs(100);
  await renderWithChart(Harness, chartV3);
  await flushMs(100);
  await renderWithChart(Harness, chartV4);

  // Well before the 600ms debounce window elapses from the last change.
  await flushMs(300);
  assert.equal(fetchCalls.length, 0, 'no request should fire before the debounce window elapses');

  // Let the debounce timer settle after the LAST change.
  await flushMs(400);

  assert.equal(
    fetchCalls.length,
    1,
    `expected exactly one debounced /api/charts/preview request for a burst of changes, got ${fetchCalls.length}`
  );
  assert.match(fetchCalls[0].url, /\/api\/charts\/preview$/);
});

test('loading state is true from request start until the response resolves', async () => {
  const { Harness } = mountHook();
  const chart = { name: 'c1', title: 'Draft', type: 'bar', questions: ['q1'] };
  await renderWithChart(Harness, chart);

  await flushMs(650);
  assert.equal(fetchCalls.length, 1, 'precondition: debounced request should have fired');
  assert.equal(hookState.loading, true, 'loading should be true once the request has fired');

  // Resolve the pending fetch with a successful preview payload.
  await act(async () => {
    pendingResolvers[0].resolve(okResponse({ image: 'data:image/png;base64,AAAA' }));
    // allow the resulting promise chain (response.json(), state updates) to flush
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  assert.equal(hookState.loading, false, 'loading should be false once the response has resolved');
});

test('a non-2xx response sets an error state, not loading and not a stale success state', async () => {
  const { Harness } = mountHook();
  const chart = { name: 'c1', title: 'Draft', type: 'bar', questions: ['q1'] };
  await renderWithChart(Harness, chart);

  await flushMs(650);
  assert.equal(fetchCalls.length, 1, 'precondition: debounced request should have fired');

  await act(async () => {
    pendingResolvers[0].resolve(errorResponse(500, { detail: 'render failed' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  assert.equal(hookState.loading, false, 'a failed request must not leave loading stuck true');
  assert.ok(hookState.error, 'a non-2xx response must populate an error state');
  assert.equal(
    hookState.image ?? hookState.src ?? null,
    null,
    'a failed request must not leave a stale successful preview image'
  );
});
