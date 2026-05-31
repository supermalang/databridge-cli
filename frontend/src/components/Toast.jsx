import { createContext, useCallback, useContext, useState } from 'react';

const ToastCtx = createContext(() => {});

// Wrap your app in <ToastProvider/> and call useToast() anywhere.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((text, type = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, text, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 999 }}>
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`} style={{ position: 'static' }}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
