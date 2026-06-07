// Project list + active project, backed by /api/projects.
export async function listProjects() {
  try {
    const res = await fetch('/api/projects');
    if (!res.ok) return { projects: [], active_id: null };
    return await res.json();
  } catch {
    return { projects: [], active_id: null };
  }
}

export async function activateProject(id) {
  const res = await fetch(`/api/projects/${id}/activate`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to activate project');
  return res.json();
}

export async function createProject(payload) {
  // payload: { name, description?, tags?, language?, color?, icon? }
  const body = typeof payload === 'string' ? { name: payload } : payload;
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed to create project');
  return res.json();
}

export async function updateProject(id, patch) {
  const res = await fetch(`/api/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.detail || 'Update failed');
  }
  return res.json();
}

export async function archiveProject(id, archived) {
  const action = archived ? 'archive' : 'unarchive';
  const res = await fetch(`/api/projects/${id}/${action}`, { method: 'POST' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.detail || 'Archive failed');
  }
  return res.json();
}
