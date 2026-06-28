import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { loadConfig, loadConfigText } from './config.js';

const ConfigCtx = createContext(null);

export function ConfigProvider({ children, activeProjectId }) {
  const [cfg, setCfg] = useState(null);
  const [cfgText, setCfgText] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const [parsed, raw] = await Promise.all([loadConfig(), loadConfigText()]);
      setCfg(parsed ?? {});
      setCfgText(raw);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Reset + reload when the active project changes
  useEffect(() => {
    if (!activeProjectId) return;
    setCfg(null);
    setCfgText('');
    reload();
  }, [activeProjectId, reload]);

  // Reload when a CLI command completes and may have changed config on the server
  // (e.g. fetch-questions populates the questions array in config.yml).
  // Skip project-switch events (handled above) and UI-save events (those call
  // updateCfg directly so no round-trip is needed).
  useEffect(() => {
    const onChanged = (e) => {
      if (e?.detail?.project) return;
      if (e?.detail?.source) return;
      reload();
    };
    window.addEventListener('databridge:data-changed', onChanged);
    return () => window.removeEventListener('databridge:data-changed', onChanged);
  }, [reload]);

  // Called by pages after they write to the server so the context stays in sync
  // without an extra round-trip.
  const updateCfg = useCallback((newCfg, newText) => {
    setCfg(newCfg ?? {});
    if (newText !== undefined) setCfgText(newText);
  }, []);

  return (
    <ConfigCtx.Provider value={{ cfg, cfgText, isLoading, updateCfg, reload }}>
      {children}
    </ConfigCtx.Provider>
  );
}

export function useConfig() {
  return useContext(ConfigCtx);
}
