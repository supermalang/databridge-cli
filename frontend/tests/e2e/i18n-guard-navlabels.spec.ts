import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * I18N-5 — `check:i18n` must catch a user-facing `label:` literal in the
 * STAGES / nav data arrays (the coverage escape that let the sub-tabs stay
 * English).
 *
 * AC encoded here:
 *   - `check:i18n` is EXTENDED so a user-facing `label:` string literal in the
 *     STAGES / nav data arrays FAILS the check (it would flag the regression if
 *     the t() wiring were removed) and PASSES on the fixed (t()-wired) code.
 *   - en/fr stay key-aligned and the gate passes on the real repository source.
 *
 * These run the guard as a BLACK BOX. The script resolves its scan root relative
 * to its own file location (ROOT = <script>/.. ; SRC = ROOT/src), so copying the
 * REAL committed scripts/check-i18n.mjs into a temporary `scripts/` dir makes it
 * scan a temporary `src/` tree we control — no implementation hooks required.
 * The guard `continue`s past AUDITED files that don't exist, so a fixture need
 * only provide locales + the one file under test (App.jsx).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, '..', '..');               // frontend/
const REAL_SCRIPT = join(FRONTEND, 'scripts', 'check-i18n.mjs');

// Minimal, key-aligned en/fr bundles that satisfy checks (A)+(B). They include
// the `subs.*` keys the fixed App.jsx wires to.
const EN_BUNDLE = JSON.stringify({
  translation: {
    nav: { home: 'Home', extract: 'Extract', transform: 'Transform' },
    shell: { stageSections: 'Sections', workflowStages: 'Stages' },
    subs: { connection: 'Connection', ai: 'AI configuration', questions: 'Questions', profile: 'Profile', validate: 'Validate' },
  },
});
const FR_BUNDLE = JSON.stringify({
  translation: {
    nav: { home: 'Accueil', extract: 'Extraire', transform: 'Transformer' },
    shell: { stageSections: 'Sections', workflowStages: 'Étapes' },
    subs: { connection: 'Connexion', ai: 'Configuration de l’IA', questions: 'Questions', profile: 'Profil', validate: 'Valider' },
  },
});

// A STAGES/nav data array whose sub-tab labels are WIRED through t() against the
// existing subs.* keys (the FIXED shape the implementer ships). No user-facing
// prose literal is exposed for rendering — labels render via t().
const APP_WIRED = `
import { useTranslation } from 'react-i18next';
const STAGES = [
  { id: 'home', labelKey: 'nav.home', home: true },
  { id: 'transform', labelKey: 'nav.transform', subs: [
    { id: 'questions', labelKey: 'subs.questions', render: () => null },
    { id: 'profile',   labelKey: 'subs.profile',   render: () => null },
    { id: 'validate',  labelKey: 'subs.validate',  render: () => null },
  ] },
];
export default function App() {
  const { t } = useTranslation();
  return (
    <nav className="subtabs-bar">
      {STAGES[1].subs.map(sub => (
        <button key={sub.id} className="subtab">{t(sub.labelKey)}</button>
      ))}
    </nav>
  );
}
`;

// The REGRESSION shape: a user-facing prose label literal back in the data array,
// rendered directly ({sub.label}) instead of through t(). The guard MUST flag it.
const APP_REGRESSED = `
const STAGES = [
  { id: 'home', label: 'Home', home: true },
  { id: 'transform', label: 'Transform', subs: [
    { id: 'questions', label: 'Questions', render: () => null },
    { id: 'profile',   label: 'AI configuration', render: () => null },
    { id: 'validate',  label: 'Validate', render: () => null },
  ] },
];
export default function App() {
  return (
    <nav className="subtabs-bar">
      {STAGES[1].subs.map(sub => (
        <button key={sub.id} className="subtab">{sub.label}</button>
      ))}
    </nav>
  );
}
`;

// Build a throwaway project: <tmp>/scripts/check-i18n.mjs + <tmp>/src/{locales,App.jsx}.
function makeFixture(appJsx: string): string {
  const root = mkdtempSync(join(tmpdir(), 'i18n5-guard-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'src', 'locales'), { recursive: true });
  copyFileSync(REAL_SCRIPT, join(root, 'scripts', 'check-i18n.mjs'));
  writeFileSync(join(root, 'src', 'locales', 'en.json'), EN_BUNDLE);
  writeFileSync(join(root, 'src', 'locales', 'fr.json'), FR_BUNDLE);
  writeFileSync(join(root, 'src', 'App.jsx'), appJsx);
  return root;
}

// Run the guard in a fixture; return { code, output }.
function runGuard(root: string): { code: number; output: string } {
  try {
    const out = execFileSync('node', [join(root, 'scripts', 'check-i18n.mjs')], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { code: 0, output: out };
  } catch (e: any) {
    return { code: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

test.describe('I18N-5 — check:i18n guards nav/data-array label literals', () => {
  // The guard runs once per playwright project (3 viewports); it is viewport-
  // independent, so the assertions are identical and cheap.

  test('FAILS on a user-facing label literal in the STAGES/nav data array', async () => {
    const root = makeFixture(APP_REGRESSED);
    try {
      const { code, output } = runGuard(root);
      expect(
        code,
        `check:i18n must FAIL (non-zero exit) when a user-facing label literal lives in the STAGES/nav array.\n${output}`,
      ).not.toBe(0);
      // And the failure must name the offending label literal, not some unrelated check.
      expect(output).toMatch(/AI configuration/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('PASSES when the sub-tab labels are wired through t() (the fixed shape)', async () => {
    const root = makeFixture(APP_WIRED);
    try {
      const { code, output } = runGuard(root);
      expect(
        code,
        `check:i18n must PASS when nav labels are sourced from subs.* via t().\n${output}`,
      ).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('PASSES on the real repository source (en/fr aligned, no escapes)', async () => {
    const { code, output } = runGuard(FRONTEND);
    expect(code, `check:i18n must pass on the real source.\n${output}`).toBe(0);
  });
});
