import yaml from 'js-yaml';

// GET /api/config → parsed JS object. Returns {} if not found / unparseable.
export async function loadConfig() {
  try {
    const data = await (await fetch('/api/config')).json();
    return yaml.load(data.content || '') || {};
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
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || 'Save failed');
  }
  return res.json();
}

export async function loadConfigText() {
  try {
    const data = await (await fetch('/api/config')).json();
    return data.content || '';
  } catch {
    return '';
  }
}
