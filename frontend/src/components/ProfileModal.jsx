import { useState } from 'react';
import Modal from './Modal.jsx';
import { useToast } from './Toast.jsx';
import { updateProfile } from '../lib/auth.js';

// Edit the signed-in user's display name. Email is Zitadel-owned (read-only).
export default function ProfileModal({ me, onClose, onSaved }) {
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
      onClose();
    } catch (e) { toast(e.message || 'Update failed', 'err'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Your profile" onClose={onClose} onSave={save}
           saveLabel={busy ? 'Saving…' : 'Save'}>
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
        <input value={me?.email || ''} disabled />
      </div>
    </Modal>
  );
}
