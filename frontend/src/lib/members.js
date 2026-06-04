// Project members + invitations, backed by /api/projects/{id}/members*.
import { handle401 } from './auth.js';

export async function listMembers(projectId) {
  const res = await fetch(`/api/projects/${projectId}/members`);
  if (!res.ok) { handle401(res); throw new Error('Failed to load members'); }
  return res.json();
}

export async function inviteMember(projectId, email, role) {
  const res = await fetch(`/api/projects/${projectId}/members/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) {
    if (handle401(res)) return;
    const d = await res.json().catch(() => ({}));
    throw new Error(d.detail || 'Invite failed');
  }
  return res.json();
}

export async function changeMemberRole(projectId, userId, role) {
  const res = await fetch(`/api/projects/${projectId}/members/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) {
    if (handle401(res)) return;
    const d = await res.json().catch(() => ({}));
    throw new Error(d.detail || 'Role change failed');
  }
  return res.json();
}

export async function removeMember(projectId, userId) {
  const res = await fetch(`/api/projects/${projectId}/members/${userId}`, { method: 'DELETE' });
  if (!res.ok) {
    if (handle401(res)) return;
    const d = await res.json().catch(() => ({}));
    throw new Error(d.detail || 'Remove failed');
  }
  return res.json();
}

export async function deleteProject(projectId) {
  const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
  if (!res.ok) {
    if (handle401(res)) return;
    const d = await res.json().catch(() => ({}));
    throw new Error(d.detail || 'Delete failed');
  }
  return res.json();
}
