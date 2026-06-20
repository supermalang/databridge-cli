import { useEffect, useState } from 'react';
import { useConfirm } from './ConfirmDialog.jsx';
import { useToast } from './Toast.jsx';
import { roleAtLeast } from '../lib/perms.js';
import { listMembers, inviteMember, changeMemberRole, removeMember } from '../lib/members.js';

const ROLES = ['viewer', 'editor', 'admin'];

// Roster + role changes + invites for one project. No Modal chrome — embed anywhere.
export default function ProjectMembersPanel({ project }) {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [data, setData] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setData(await listMembers(project.id)); }
    catch (e) { toast(e.message, 'err'); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [project.id]);

  const myRole = data?.my_role;
  const isAdmin = roleAtLeast(myRole, 'admin');
  const isSuper = myRole === 'superadmin';
  const locked = (m) => m.is_owner && !isSuper;

  const invite = async () => {
    if (!email.includes('@')) { toast('Enter a valid email', 'err'); return; }
    setBusy(true);
    try {
      const r = await inviteMember(project.id, email.trim(), role);
      const note = r?.attached ? 'added to project' :
        (r?.zitadel === 'created' ? 'invited (Zitadel email sent)' :
         r?.zitadel?.startsWith('error') ? `invited; Zitadel: ${r.zitadel}` : 'invited');
      toast(`${email} — ${note}`, 'ok');
      setEmail('');
      await load();
    } catch (e) { toast(e.message, 'err'); }
    finally { setBusy(false); }
  };

  const setRoleFor = async (m, newRole) => {
    try { await changeMemberRole(project.id, m.user_id, newRole); await load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const remove = async (m) => {
    if (!await confirm({
      title: 'Remove member?',
      message: `${m.email || m.name} will lose access to “${project.name}”.`,
      confirmLabel: 'Remove',
    })) return;
    try { await removeMember(project.id, m.user_id); toast('Removed', 'ok'); await load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  if (!data) return <p style={{ color: 'var(--muted)' }}>Loading…</p>;
  // Tolerate a malformed/partial payload so a bad /members response can't crash
  // the whole form (A11Y-2: the Members tab must render when reached by keyboard).
  const members = Array.isArray(data.members) ? data.members : [];
  const invitations = Array.isArray(data.invitations) ? data.invitations : [];
  return (
    <>
      <table className="members-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 13 }}>
            <th style={{ padding: '6px 4px' }}>Member</th>
            <th style={{ padding: '6px 4px' }}>Role</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {members.map(m => (
            <tr key={m.user_id} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '8px 4px' }}>
                {m.email || m.name || m.user_id}
                {m.is_owner && <span className="badge" style={{ marginLeft: 6 }}>owner</span>}
                {m.is_superadmin && <span className="badge" style={{ marginLeft: 6 }}>superadmin</span>}
              </td>
              <td style={{ padding: '8px 4px' }}>
                {isAdmin && !locked(m) ? (
                  <select value={m.role} onChange={e => setRoleFor(m, e.target.value)}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                ) : <span>{m.role}</span>}
              </td>
              <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                {isAdmin && !locked(m) && (
                  <button className="btn btn-danger btn-sm" onClick={() => remove(m)}>Remove</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {invitations.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 4 }}>Pending invites</div>
          {invitations.map(i => (
            <div key={i.email} style={{ fontSize: 13, padding: '2px 0' }}>
              {i.email} — <strong>{i.role}</strong> <span style={{ color: 'var(--muted)' }}>({i.status})</span>
            </div>
          ))}
        </div>
      )}

      {isAdmin ? (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Invite someone</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="email" placeholder="email@example.com" value={email}
                   onChange={e => setEmail(e.target.value)} style={{ flex: 1 }} />
            <select value={role} onChange={e => setRole(e.target.value)}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={invite}>
              {busy ? 'Inviting…' : 'Invite'}
            </button>
          </div>
        </div>
      ) : (
        <p style={{ marginTop: 12, color: 'var(--muted)', fontSize: 13 }}>
          You have <strong>{myRole}</strong> access. Only admins can invite or change roles.
        </p>
      )}
      {confirmDialog}
    </>
  );
}
