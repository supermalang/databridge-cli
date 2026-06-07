import { useEffect, useRef, useState } from 'react';
import ProfileModal from './ProfileModal.jsx';

function initials(me) {
  const src = (me?.name || me?.email || '?').trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  const two = (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
  return (two || src.slice(0, 2)).toUpperCase();
}

// Circular avatar that opens a dropdown: identity header, Profile, Sign out.
export default function UserMenu({ me, role, isSuperadmin, onProfileSaved }) {
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const ref = useRef(null);
  const isDev = !me || me.sub === 'dev-local';

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="user-menu" ref={ref}>
      <button className="user-avatar" title={me?.email || 'Account'} type="button"
              onClick={() => setOpen(o => !o)}>
        {initials(me)}
      </button>
      {open && (
        <div className="user-menu__dropdown">
          <div className="user-menu__head">
            <div className="user-menu__name">{me?.name || 'Account'}</div>
            <div className="user-menu__email">{me?.email || ''}</div>
            <div className="user-menu__badges">
              {isSuperadmin && <span className="badge-role">superadmin</span>}
              {role && !isSuperadmin && <span className="badge-role">{role}</span>}
            </div>
          </div>
          <div className="user-menu__sep" />
          <button className="user-menu__item" onClick={() => { setOpen(false); setProfileOpen(true); }}>
            Profile
          </button>
          {!isDev && (
            <form method="POST" action="/auth/logout" style={{ margin: 0 }}>
              <button type="submit" className="user-menu__item user-menu__danger">Sign out</button>
            </form>
          )}
        </div>
      )}
      {profileOpen && (
        <ProfileModal me={me} onClose={() => setProfileOpen(false)} onSaved={onProfileSaved} />
      )}
    </div>
  );
}
