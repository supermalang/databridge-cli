// i18n bootstrap (I18N-1). React-i18next wrapping the SPA with an English
// (default) + French resource bundle and a translation hook. The interface
// language is a per-user preference stored server-side (GET/PATCH /api/me); the
// app applies the saved value on load via setLanguage() and the Profile
// switcher flips it live. We also mirror the active choice into localStorage as
// a fast first-paint hint so the UI doesn't flash English before /api/me
// resolves — the server value remains the source of truth.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import fr from '../locales/fr.json';

export const SUPPORTED_LANGUAGES = ['en', 'fr'];
export const DEFAULT_LANGUAGE = 'en';
const STORAGE_KEY = 'databridge.language';

// Coerce any value to a supported language, falling back to English.
export function normalizeLanguage(lang) {
  return SUPPORTED_LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;
}

function initialLanguage() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) return normalizeLanguage(stored);
  } catch { /* localStorage may be unavailable */ }
  return DEFAULT_LANGUAGE;
}

i18n.use(initReactI18next).init({
  resources: { en, fr },
  lng: initialLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES,
  interpolation: { escapeValue: false },   // React already escapes
  returnNull: false,
});

// Apply a language across the app (live, no reload) and persist the fast-paint
// hint. Server persistence is the caller's responsibility (PATCH /api/me).
export function setLanguage(lang) {
  const next = normalizeLanguage(lang);
  i18n.changeLanguage(next);
  try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* noop */ }
  return next;
}

export default i18n;
