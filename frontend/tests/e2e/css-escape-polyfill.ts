/**
 * `CSS.escape` polyfill for the Playwright test runner (Node).
 *
 * Specs run in Node, where the browser-only `CSS` global is absent. Several a11y
 * specs resolve elements by id with `CSS.escape(id)` — and React's `useId()`
 * emits ids containing `:` (e.g. `:r1:`), which are NOT valid raw CSS
 * identifiers, so escaping is genuinely required. Importing this module from
 * `playwright.config.ts` installs `CSS.escape` once per worker (each worker
 * loads the config), so id-based locators work in every spec.
 *
 * Implements the WHATWG/CSSOM `CSS.escape` algorithm.
 */
function cssEscape(value: string): string {
  const str = String(value);
  const length = str.length;
  let result = '';
  let codeUnit: number;
  let index = -1;
  const firstCodeUnit = str.charCodeAt(0);

  while (++index < length) {
    codeUnit = str.charCodeAt(index);

    if (codeUnit === 0x0000) {
      result += '�';
      continue;
    }

    if (
      (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
      codeUnit === 0x007f ||
      (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && firstCodeUnit === 0x002d)
    ) {
      result += '\\' + codeUnit.toString(16) + ' ';
      continue;
    }

    if (index === 0 && length === 1 && codeUnit === 0x002d) {
      result += '\\' + str.charAt(index);
      continue;
    }

    if (
      codeUnit >= 0x0080 ||
      codeUnit === 0x002d ||
      codeUnit === 0x005f ||
      (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
      (codeUnit >= 0x0061 && codeUnit <= 0x007a)
    ) {
      result += str.charAt(index);
      continue;
    }

    result += '\\' + str.charAt(index);
  }
  return result;
}

const g = globalThis as { CSS?: { escape?: (v: string) => string } };
if (!g.CSS) g.CSS = { escape: cssEscape };
else if (typeof g.CSS.escape !== 'function') g.CSS.escape = cssEscape;

export {};
