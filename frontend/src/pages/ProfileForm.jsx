import { useState } from 'react';
import { useToast } from '../components/Toast.jsx';
import { updateProfile } from '../lib/auth.js';

// Full-screen profile page (shares the project-form overlay shell). Edits the
// signed-in user's display name; email is Zitadel-owned (read-only).
export default function ProfileForm({ me, onDone, onSaved }) {
  const toast = useToast();
  const parts = (me?.name || '').trim().split(' ');
  const [given, setGiven] = useState(parts[0] || '');
  const [family, setFamily] = useState(parts.slice(1).join(' ') || '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const updated = await updateProfile({ given_name: given.trim(), family_name: family.trim() });
      toast('Profile updated', 'ok');
      onSaved?.(updated);
      onDone?.();
    } catch (e) { toast(e.message || 'Update failed', 'err'); }
    finally { setBusy(false); }
  };

  return (
    <div className="project-form">
      <div className="project-form__bar">
        <button className="btn btn-sm" onClick={() => onDone?.()}>← Back</button>
        <h2 className="project-form__title">Your profile</h2>
      </div>
      <div className="project-form__body">
        <div className="pf-panel">
          <div className="profile-field">
            <label>First name</label>
            <input autoFocus value={given} onChange={e => setGiven(e.target.value)} />
          </div>
          <div className="profile-field">
            <label>Last name</label>
            <input value={family} onChange={e => setFamily(e.target.value)} />
          </div>
          <div className="profile-field">
            <label>Email</label>
            <input value={me?.email || ''} disabled aria-describedby="profile-email-hint" />
            <div id="profile-email-hint" className="pf-field-hint">Managed by your sign-in provider</div>
          </div>
          <div className="pf-actions">
            <button className="btn btn-primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
