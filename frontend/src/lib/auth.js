import { clearCache } from './cache.js';

// On a 401 from any API call, the session is gone/expired — bounce to the IdP login.
// Returns true if it handled (redirected), so callers can stop processing.
// The whole SWR cache is wiped first so no stale (or another user's) data can
// persist across the logout / re-login (PERF-4).
export function handle401(res) {
  if (res && res.status === 401) {
    clearCache();
    window.location.href = '/auth/login';
    return true;
  }
  return false;
}

// Who am I? Returns the user object, or null if not signed in.
// A 401 here means auth is enabled and there's no session yet → bounce to the
// IdP login (handle401 navigates away). In dev mode /api/me returns the dev
// user (200), so this never fires.
export async function fetchMe() {
  try {
    const res = await fetch('/api/me');
    if (handle401(res)) return null;
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Update the signed-in user's profile. `name` parts propagate to Zitadel
// server-side when configured; `language` persists the interface-language
// preference (I18N-1). Only the keys passed are sent. Returns the updated user.
export async function updateProfile(patch = {}) {
  const body = {};
  if (patch.given_name !== undefined) body.given_name = patch.given_name;
  if (patch.family_name !== undefined) body.family_name = patch.family_name;
  if (patch.language !== undefined) body.language = patch.language;
  const res = await fetch('/api/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.detail || 'Profile update failed');
  }
  return res.json();
}
