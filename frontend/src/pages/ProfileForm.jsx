import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../components/Toast.jsx';
import { updateProfile } from '../lib/auth.js';
import { setLanguage, normalizeLanguage } from '../lib/i18n.js';

// Full-screen profile page (shares the project-form overlay shell). Edits the
// signed-in user's display name; email is Zitadel-owned (read-only). Also hosts
// the interface-language switcher (I18N-1): exactly English + French, switching
// the wired strings LIVE and persisting the choice to the user's profile.
export default function ProfileForm({ me, onDone, onSaved }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const parts = (me?.name || '').trim().split(' ');
  const [given, setGiven] = useState(parts[0] || '');
  const [family, setFamily] = useState(parts.slice(1).join(' ') || '');
  const [busy, setBusy] = useState(false);
  // Reflect the saved preference on load; fall back to the live i18n language.
  const [lang, setLang] = useState(normalizeLanguage(me?.language || i18n.language));

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

  // Switch the interface language LIVE (no reload) and persist the choice to the
  // user's profile. The UI updates immediately; the PATCH records it server-side
  // so it is re-applied on the next load. A failed PATCH surfaces a toast but the
  // live switch stands (the next reload reconciles with the stored value).
  const onLanguageChange = async (e) => {
    const next = normalizeLanguage(e.target.value);
    setLang(next);
    setLanguage(next);
    onSaved?.({ ...(me || {}), language: next });
    try {
      await updateProfile({ language: next });
    } catch (err) {
      toast(err.message || 'Could not save language', 'err');
    }
  };

  return (
    <div className="project-form">
      <div className="project-form__bar">
        <button className="btn btn-sm" onClick={() => onDone?.()}>← {t('profile.back')}</button>
        <h2 className="project-form__title">{t('profile.title')}</h2>
      </div>
      <div className="project-form__body">
        <div className="pf-panel">
          <div className="profile-field">
            <label htmlFor="profile-given">{t('profile.firstName')}</label>
            <input id="profile-given" autoFocus value={given} onChange={e => setGiven(e.target.value)} />
          </div>
          <div className="profile-field">
            <label htmlFor="profile-family">{t('profile.lastName')}</label>
            <input id="profile-family" value={family} onChange={e => setFamily(e.target.value)} />
          </div>
          <div className="profile-field">
            <label htmlFor="profile-email">{t('profile.email')}</label>
            <input id="profile-email" value={me?.email || ''} disabled aria-describedby="profile-email-hint" />
            <div id="profile-email-hint" className="pf-field-hint">{t('profile.emailManaged')}</div>
          </div>
          <div className="profile-field">
            <label htmlFor="profile-language">{t('profile.language')}</label>
            <select
              id="profile-language"
              className="pf-select"
              data-testid="language-switcher"
              aria-label={t('profile.language')}
              value={lang}
              onChange={onLanguageChange}
            >
              <option value="en">{t('profile.languageEnglish')}</option>
              <option value="fr">{t('profile.languageFrench')}</option>
            </select>
          </div>
          <div className="pf-actions">
            <button className="btn btn-primary" disabled={busy} onClick={save}>
              {busy ? t('profile.saving') : t('profile.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
