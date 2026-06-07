// On a 401 from any API call, the session is gone/expired — bounce to the IdP login.
// Returns true if it handled (redirected), so callers can stop processing.
export function handle401(res) {
  if (res && res.status === 401) {
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

// Update the signed-in user's profile (name). Propagates to Zitadel server-side
// when configured. Returns the updated user dict.
export async function updateProfile({ given_name, family_name }) {
  const res = await fetch('/api/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ given_name, family_name }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.detail || 'Profile update failed');
  }
  return res.json();
}
