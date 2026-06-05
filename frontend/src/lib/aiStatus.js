// AI-connection guard. Interactive AI buttons stay disabled until the AI connection
// has been verified via /api/ai/test. Verification is tracked server-side by the AI
// config fingerprint, so it survives reloads but re-locks when the provider/model/key
// changes. The backend is the real authority; this only drives the UI.
import { createContext, useContext, useState, useEffect, useCallback, createElement } from 'react';

export const AI_LOCK_TIP = 'Test the AI connection first — Extract → AI configuration';

const AiStatusContext = createContext({
  configured: false, verified: false, aiReady: false, testing: false,
  refresh: () => {}, testAi: async () => ({}),
});

export const useAiStatus = () => useContext(AiStatusContext);

export function AiStatusProvider({ children }) {
  const [state, setState] = useState({ configured: false, verified: false });
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/ai/status');
      if (r.ok) setState(await r.json());
    } catch { /* leave last-known state */ }
  }, []);

  useEffect(() => {
    refresh();
    // Saving config (or switching project) can change the AI config → re-evaluate.
    const onChange = () => refresh();
    window.addEventListener('databridge:data-changed', onChange);
    return () => window.removeEventListener('databridge:data-changed', onChange);
  }, [refresh]);

  // Run the real probe against the given (live) ai config. Always returns a
  // normalized { ok, message, tokens_used } — even for HTTP errors (which arrive as
  // {detail}) or network failures — so callers can show clear feedback.
  const testAi = useCallback(async (ai) => {
    setTesting(true);
    try {
      const r = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: ai?.provider || 'openai',
          model: ai?.model || '',
          api_key: ai?.api_key || '',
          base_url: ai?.base_url || null,
        }),
      });
      const raw = await r.json().catch(() => ({}));
      const result = {
        ok: raw.ok === true,
        tokens_used: raw.tokens_used ?? null,
        message: raw.message || raw.detail || (r.ok ? 'Unknown response' : `Request failed (${r.status})`),
      };
      await refresh();   // reflect the SAVED-config verification state
      return result;
    } catch (e) {
      return { ok: false, tokens_used: null, message: e?.message || 'Network error' };
    } finally {
      setTesting(false);
    }
  }, [refresh]);

  const value = {
    configured: state.configured,
    verified: state.verified,
    aiReady: !!(state.configured && state.verified),
    testing, refresh, testAi,
  };
  return createElement(AiStatusContext.Provider, { value }, children);
}
