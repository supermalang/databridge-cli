#!/usr/bin/env node
/**
 * check:i18n — the I18N-2 coverage gate.
 *
 * Three independent checks, all must pass (non-zero exit on any failure):
 *
 *   (A) KEY PARITY  — the en/fr `translation` bundles must have the IDENTICAL
 *       set of leaf keys. A key present in one but not the other fails (this
 *       catches a French value that was forgotten, or an English key removed
 *       without removing its translation).
 *
 *   (B) NO EMPTY VALUES — no leaf value in either bundle may be an empty or
 *       whitespace-only string. An empty value means the string renders blank,
 *       which is never intentional for a user-facing label.
 *
 *   (C) NO HARDCODED USER-FACING LITERAL — a pragmatic source scan over the
 *       AUDITED COMPONENTS (the surfaces I18N-2 externalized — see AUDITED
 *       below). It flags user-facing PROSE that is still inlined in JSX instead
 *       of coming from t()/<Trans>. The heuristic is deliberately conservative:
 *       it only inspects the two places prose actually leaks to the screen, and
 *       it EXCLUDES machine-truth so the gate stays meaningful, not noisy.
 *
 *       What it scans:
 *         • JSX text nodes — visible text between `>` and `<` (e.g. `<span>Save</span>`).
 *         • A small set of user-facing string-literal ATTRIBUTES:
 *           title, aria-label, placeholder, alt, saveLabel, confirmLabel.
 *
 *       What counts as a FLAGGED literal (must be externalized):
 *         • contains a run of ≥2 ASCII letters AND at least one ASCII SPACE
 *           between two letters — i.e. it reads as a multi-word English phrase.
 *           Single tokens (icons, "CSV", "YAML", a class name) are NOT prose.
 *
 *       EXCLUSIONS (machine-truth / not user prose — never flagged):
 *         • Anything already wrapped in t(...) / i18n / <Trans> (it is sourced
 *           from the bundle by construction — the scan sees the call, not a
 *           bare literal).
 *         • Strings with NO inner space (filenames, ids, single words, glyphs).
 *         • config.yml paths & code tokens (api.url, env:KOBO_TOKEN, build-report,
 *           download, fetch-questions) and Jinja/docxtpl placeholders ({{ ... }}).
 *         • URLs / domains / file extensions (https://…, kobotoolbox.org, .docx).
 *         • Strings that are ONLY punctuation / arrows / symbols (↺ ✕ → ⚙ ▾ ↗).
 *         • SVG path geometry and viewBox/points/d attribute data.
 *         • Lines in code COMMENTS (line and block comments) and import/test ids.
 *         • Rich disclosure HELP-BODY prose passed as a `body={ ... }` JSX
 *           expression made of element nodes — documented pragmatic exclusion:
 *           that markup is externalized via <Trans> where present and otherwise
 *           tracked as follow-up copy review, not a bare top-level literal.
 *
 * Usage:  node scripts/check-i18n.mjs        (run from frontend/)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SRC = join(ROOT, 'src');

// ── The audited surfaces (I18N-2 scope). check (C) scans exactly these. ──────
const AUDITED = [
  'App.jsx',
  'pages/Home.jsx',
  'pages/Sources.jsx',
  'pages/Questions.jsx',
  'pages/Composition.jsx',
  'pages/Reports.jsx',
  'pages/Templates.jsx',
  'pages/PageHeader.jsx',
  'components/StageHelp.jsx',
  'components/Rail.jsx',
  'components/Modal.jsx',
  'components/EmptyState.jsx',
  'components/ConfirmDialog.jsx',
].map((p) => join(SRC, p));

let failures = 0;
const fail = (msg) => { failures++; console.error('  ✗ ' + msg); };

// ── (A) + (B): bundle parity + no-empty ─────────────────────────────────────
function leafKeys(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...leafKeys(v, key));
    else out.push([key, v]);
  }
  return out;
}

console.log('check:i18n');
console.log('— (A) en/fr key parity + (B) no empty values');

const en = JSON.parse(readFileSync(join(SRC, 'locales/en.json'), 'utf8')).translation;
const fr = JSON.parse(readFileSync(join(SRC, 'locales/fr.json'), 'utf8')).translation;
const enLeaves = leafKeys(en);
const frLeaves = leafKeys(fr);
const enKeys = new Set(enLeaves.map(([k]) => k));
const frKeys = new Set(frLeaves.map(([k]) => k));

for (const k of enKeys) if (!frKeys.has(k)) fail(`key in en but missing from fr: ${k}`);
for (const k of frKeys) if (!enKeys.has(k)) fail(`key in fr but missing from en: ${k}`);

for (const [k, v] of [...enLeaves, ...frLeaves]) {
  if (typeof v !== 'string' || v.trim() === '') fail(`empty / non-string value: ${k}`);
}
if (failures === 0) console.log(`  ✓ ${enKeys.size} keys, en/fr aligned, no empty values`);

// ── (C): hardcoded user-facing literal scan ──────────────────────────────────
console.log('— (C) no hardcoded user-facing literal in audited components');

// Strip line + block comments so prose in comments never trips the scan.
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');   // keep http:// (preceded by ':')
}

// A "phrase" = has ≥2 consecutive ASCII letters somewhere AND a space flanked by
// letters (so it reads as multiple words). Single words / tokens are not prose.
// We also reject anything that smells like JS source rather than visible copy —
// the `>…<` text-node regex inevitably catches arrow bodies (`=>`), comparisons
// and JSX expression code, none of which is user prose. Real JSX text never
// contains JS punctuation like ; { } ( ) = | & or arrow/comparison operators.
function isPhrase(s) {
  const t = s.trim();
  if (!/[A-Za-z]{2,}/.test(t)) return false;
  if (!/[A-Za-z] [A-Za-z]/.test(t)) return false;   // needs an inter-word space
  if (/[;{}=|&[\]]/.test(t)) return false;            // JS punctuation → not prose
  if (/=>|`|\$\{|=== |!==/.test(t)) return false;     // arrow / template / compare
  // Parentheses are legitimate in copy ("(from form)") but a `()` with code-ish
  // content (a call) is not prose; reject an empty or operator-only paren group.
  if (/\(\s*\)/.test(t)) return false;
  if (/\b(const|return|await|function|new |typeof|null|undefined)\b/.test(t)) return false;
  if (/\{\{.*?\}\}/.test(t)) return false;            // docxtpl/jinja placeholder
  if (/https?:\/\//.test(t)) return false;            // URL
  return true;
}

const cHadFailure = failures;
for (const file of AUDITED) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch { continue; }
  const src = stripComments(raw);
  const rel = file.slice(ROOT.length + 1);

  // JSX text nodes: text between a closing `>` and the next `<`. We then drop
  // any segment that is an interpolation `{...}` only, or whitespace.
  const textNodes = [];
  const re = />([^<>{}][^<>]*?)</g;   // starts with a non-{,<,> char
  let m;
  while ((m = re.exec(src))) {
    const txt = m[1].replace(/\s+/g, ' ').trim();
    if (txt) textNodes.push(txt);
  }

  // User-facing string-literal attributes.
  const attrRe = /\b(title|aria-label|placeholder|alt|saveLabel|confirmLabel)\s*=\s*"([^"]*)"/g;
  const attrLits = [];
  while ((m = attrRe.exec(src))) attrLits.push(m[2]);

  for (const lit of [...textNodes, ...attrLits]) {
    if (isPhrase(lit)) fail(`${rel}: hardcoded literal "${lit}"`);
  }
}
if (failures === cHadFailure) console.log('  ✓ no hardcoded user-facing prose in audited components');

if (failures) {
  console.error(`\ncheck:i18n FAILED with ${failures} problem(s).`);
  process.exit(1);
}
console.log('\ncheck:i18n PASSED.');
