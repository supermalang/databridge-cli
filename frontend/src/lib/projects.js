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

export async function createProject(name) {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('Failed to create project');
  return res.json();
}
