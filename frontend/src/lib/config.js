import yaml from 'js-yaml';
import { handle401 } from './auth.js';
import { swr } from './cache.js';

// GET /api/config → parsed JS object. Returns {} if not found / unparseable.
// Uses the SWR cache's IN-MEMORY tier only (PERF-4): /api/config carries the
// API token, so it is NOT on the persist whitelist and is never written to disk.
// Within a session a revisit is instant; a hard reload re-fetches.
export async function loadConfig() {
  try {
    return await swr('/api/config', async () => {
      const res = await fetch('/api/config');
      if (!res.ok) { handle401(res); return {}; }
      const data = await res.json();
      return yaml.load(data.content || '') || {};
    });
  } catch {
    return {};
  }
}

// POST /api/config with merged-in change. `mutator(cfg)` mutates the loaded
// object; we serialize back to YAML and write the whole file.
export async function saveConfigPatch(mutator) {
  const cfg = await loadConfig();
  mutator(cfg);
  const body = JSON.stringify({ content: yaml.dump(cfg, { indent: 2, lineWidth: -1 }) });
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) {
    if (handle401(res)) return;
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || 'Save failed');
  }
  return res.json();
}

// Save raw YAML text (used by the YAML view).
export async function saveConfigText(content) {
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    if (handle401(res)) return;
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || 'Save failed');
  }
  return res.json();
}

export async function loadConfigText() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) { handle401(res); return ''; }
    const data = await res.json();
    return data.content || '';
  } catch {
    return '';
  }
}
