import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

function initials(me) {
  const src = (me?.name || me?.email || '?').trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  const two = (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
  return (two || src.slice(0, 2)).toUpperCase();
}

// Circular avatar that opens a dropdown: identity header, Profile, Sign out.
// "Profile" delegates to onOpenProfile (the parent opens a full-screen page).
export default function UserMenu({ me, role, isSuperadmin, onOpenProfile }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
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
      <button className="user-avatar" title={me?.email || t('components.userMenu.account')} type="button"
              onClick={() => setOpen(o => !o)}>
        {initials(me)}
      </button>
      {open && (
        <div className="user-menu__dropdown">
          <div className="user-menu__head">
            <div className="user-menu__name">{me?.name || t('components.userMenu.account')}</div>
            <div className="user-menu__email">{me?.email || ''}</div>
            <div className="user-menu__badges">
              {isSuperadmin && <span className="badge-role">{t('components.userMenu.superadmin')}</span>}
              {role && !isSuperadmin && <span className="badge-role">{role}</span>}
            </div>
          </div>
          <div className="user-menu__sep" />
          <button className="user-menu__item" onClick={() => { setOpen(false); onOpenProfile?.(); }}>
            {t('components.userMenu.profile')}
          </button>
          {!isDev && (
            <form method="POST" action="/auth/logout" style={{ margin: 0 }}>
              <button type="submit" className="user-menu__item user-menu__danger">{t('components.userMenu.signOut')}</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
