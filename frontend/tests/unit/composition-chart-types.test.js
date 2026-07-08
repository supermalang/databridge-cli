// MNT-33 -- the Composition chart-type dropdown must no longer offer `table`.
//
// Acceptance criterion under test (docs/ROADMAP.md, MNT-33):
//   "The Composition chart-type dropdown no longer offers `table`; the Tables
//    section remains the way to add a native table."
//
// The card's frontend AC is: assert `CHART_TYPES` excludes 'table'.
//
// `CHART_TYPES` is a module-level const in frontend/src/pages/Composition.jsx
// (not exported). Node's test runner cannot import a JSX module without a
// loader, so this test parses the `CHART_TYPES = [ ... ]` array literal from the
// source and asserts membership. This encodes the requirement on the named
// constant the card itself references, without depending on any implementation
// behaviour beyond that list's contents.
//
// Run with:
//   cd frontend && node --test tests/unit/composition-chart-types.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPOSITION = resolve(__dirname, '../../src/pages/Composition.jsx');

/**
 * Extract the string members of the `CHART_TYPES = [ ... ];` array literal from
 * the Composition source. Balances brackets so trailing content is ignored.
 */
function readChartTypes() {
  const src = readFileSync(COMPOSITION, 'utf8');
  const marker = 'CHART_TYPES';
  const declIdx = src.indexOf(marker);
  assert.notEqual(declIdx, -1, 'CHART_TYPES declaration not found in Composition.jsx');
  const openIdx = src.indexOf('[', declIdx);
  assert.notEqual(openIdx, -1, 'CHART_TYPES array-literal opening bracket not found');

  let depth = 0;
  let closeIdx = -1;
  for (let i = openIdx; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) { closeIdx = i; break; }
    }
  }
  assert.notEqual(closeIdx, -1, 'CHART_TYPES array-literal closing bracket not found');

  const body = src.slice(openIdx + 1, closeIdx);
  const members = [];
  const re = /'([^']*)'|"([^"]*)"/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    members.push(m[1] ?? m[2]);
  }
  assert.ok(members.length > 0, 'CHART_TYPES parsed as empty -- parser or source changed');
  return members;
}

test('CHART_TYPES no longer offers the `table` chart type', () => {
  const types = readChartTypes();
  assert.ok(
    !types.includes('table'),
    `CHART_TYPES still includes 'table' (${JSON.stringify(types)}). The table ` +
      'chart type must be removed from the Composition dropdown; native tables ' +
      'are added via the Tables section.'
  );
});

test('CHART_TYPES still offers real chart types (removal is scoped to `table`)', () => {
  const types = readChartTypes();
  // Sanity guard so the exclusion test cannot pass by wiping the whole list.
  for (const kind of ['bar', 'pie', 'line', 'histogram']) {
    assert.ok(
      types.includes(kind),
      `CHART_TYPES should still include the real chart type '${kind}' ` +
        `(${JSON.stringify(types)}). Only 'table' should be removed.`
    );
  }
});
