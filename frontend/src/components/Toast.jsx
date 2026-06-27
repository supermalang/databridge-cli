import { createContext, useCallback, useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';

const ToastCtx = createContext(() => {});

// Wrap your app in <ToastProvider/> and call useToast() anywhere.
export function ToastProvider({ children }) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts(prev => prev.filter(t => t.id !== id)), []);

  const push = useCallback((text, type = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, text, type }]);
    // Errors linger longer so they can be read and acted on.
    const ttl = type === 'err' ? 6000 : 3000;
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), ttl);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      {/* Polite live region: screen readers announce toasts as they appear. */}
      <div
        aria-live="polite"
        aria-atomic="false"
        style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 999 }}
      >
        {toasts.map(item => (
          <div
            key={item.id}
            className={`toast ${item.type}`}
            style={{ position: 'static', display: 'flex', alignItems: 'center', gap: 10 }}
            role={item.type === 'err' ? 'alert' : 'status'}
          >
            <span>{item.text}</span>
            <button
              onClick={() => dismiss(item.id)}
              aria-label={t('components.toast.dismiss')}
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', opacity: 0.7, fontSize: 14, lineHeight: 1, padding: 0 }}
            >✕</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
